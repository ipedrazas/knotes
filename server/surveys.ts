// Surveys live in DATA_DIR/surveys, three files each:
//
//   my-party.json          the survey, written once when it's published and never again
//   my-party.votes.jsonl   every vote, appended; a browser's latest line is its vote
//   my-party.closed        when the owner closed it early, if they did
//
// There are no accounts, so a browser is who you are. Publishing a survey hands the
// browser an owner token, and only that token can close or delete it. Voting sends a
// voter token the browser made up, so it gets one vote it can change while the survey
// is open. Only hashes of the tokens are kept on disk.
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { NOTE_ID } from '../shared/address.ts'
import { checkDraft, type SurveyDraft, type SurveyMeta, type SurveyView, type Voter } from '../shared/survey.ts'
import { newId, sha, writeAtomic } from './store.ts'

interface Survey extends SurveyDraft {
  id: string
  createdAt: number
  // Hash of the owner token.
  owner: string
}

interface Vote {
  // Hash of the voter token.
  voter: string
  choices: number[]
  at: number
  // Only kept for surveys with named votes.
  name?: string
  color?: string
}

interface Entry {
  survey: Survey
  votes: Map<string, Vote>
  closedAt: number | null
  timer?: NodeJS.Timeout
}

export class SurveyError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// /s/new is the page for writing a survey, so no survey can have that address.
const RESERVED = new Set(['new'])
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const HEX = /^#[0-9a-f]{6}$/i
// setTimeout can't wait longer than this; a later deadline is waited for in steps.
const MAX_DELAY = 2 ** 31 - 1

export class SurveyStore extends EventEmitter {
  private surveys = new Map<string, Entry>()
  private queues = new Map<string, Promise<unknown>>()
  readonly dir: string
  readonly trashDir: string

  constructor(dataDir: string) {
    super()
    this.dir = path.join(dataDir, 'surveys')
    this.trashDir = path.join(dataDir, '.trash')
  }

  async init() {
    await mkdir(this.dir, { recursive: true })
    await mkdir(this.trashDir, { recursive: true })

    for (const name of await readdir(this.dir)) {
      const id = /^(.+)\.json$/.exec(name)?.[1]
      if (!id || !NOTE_ID.test(id)) continue
      try {
        const survey: Survey = { ...JSON.parse(await readFile(this.file(id, '.json'), 'utf8')), id }
        if (!Array.isArray(survey.options)) throw new Error('no options')
        const entry: Entry = { survey, votes: new Map(), closedAt: null }
        const log = await readFile(this.file(id, '.votes.jsonl'), 'utf8').catch(() => '')
        for (const line of log.split('\n')) {
          try {
            const vote: Vote = JSON.parse(line)
            if (typeof vote?.voter === 'string' && Array.isArray(vote.choices)) entry.votes.set(vote.voter, vote)
          } catch {
            // a blank line, or one cut short by a crash
          }
        }
        const closed = Number(await readFile(this.file(id, '.closed'), 'utf8').catch(() => ''))
        if (closed > 0) entry.closedAt = closed
        this.surveys.set(id, entry)
        this.schedule(entry)
      } catch (err) {
        console.error(`[surveys] skipping ${name}: ${(err as Error).message}`)
      }
    }
  }

  has(id: string) {
    return this.surveys.has(id)
  }

  list(now = Date.now()): SurveyMeta[] {
    return [...this.surveys.values()]
      .map((entry) => {
        const closedAt = this.closedAt(entry, now)
        let updatedAt = Math.max(entry.survey.createdAt, closedAt ?? 0)
        for (const vote of entry.votes.values()) updatedAt = Math.max(updatedAt, vote.at)
        const { id, question } = entry.survey
        return { id, question, votes: entry.votes.size, closed: closedAt !== null, updatedAt }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  view(id: string, who: { voter?: unknown; owner?: unknown } = {}, now = Date.now()): SurveyView | undefined {
    const entry = this.surveys.get(id)
    if (!entry) return undefined
    const { owner: _owner, ...survey } = entry.survey
    const closedAt = this.closedAt(entry, now)
    const mine = TOKEN.test(String(who.voter)) ? (entry.votes.get(sha(String(who.voter)))?.choices ?? null) : null
    const owner = this.isOwner(entry, who.owner)

    let results: SurveyView['results'] = null
    if (closedAt !== null || owner || mine) {
      const counts = survey.options.map(() => 0)
      const voters: Voter[][] | null = survey.named ? survey.options.map(() => []) : null
      for (const vote of entry.votes.values()) {
        for (const i of vote.choices) {
          if (!(i in counts)) continue
          counts[i]++
          voters?.[i].push({ name: vote.name ?? 'Someone', color: vote.color ?? '#1d2a44' })
        }
      }
      results = { counts, voters }
    }

    return { ...survey, closed: closedAt !== null, closedAt, votes: entry.votes.size, mine, owner, results }
  }

  // Publish a survey. Returns it, and the owner token, which is never stored or shown again.
  async create(input: unknown, address?: unknown, now = Date.now()) {
    const checked = checkDraft(input, now)
    if ('error' in checked) throw new SurveyError(400, checked.error)

    let id: string
    if (address === undefined || address === null || address === '') {
      id = this.freshId()
    } else if (typeof address !== 'string' || !NOTE_ID.test(address) || RESERVED.has(address)) {
      throw new SurveyError(400, 'An address can only have letters, numbers and dashes.')
    } else if (this.surveys.has(address)) {
      throw new SurveyError(409, 'Another survey already has that address.')
    } else {
      id = address
    }

    const token = randomBytes(24).toString('base64url')
    const survey: Survey = { id, ...checked.draft, createdAt: now, owner: sha(token) }
    const entry: Entry = { survey, votes: new Map(), closedAt: null }
    // Claimed before writing, so two surveys can't race for the same address.
    this.surveys.set(id, entry)
    try {
      await this.enqueue(id, () => writeAtomic(this.file(id, '.json'), `${JSON.stringify(survey, null, 2)}\n`))
    } catch (err) {
      this.surveys.delete(id)
      throw err
    }
    this.schedule(entry)
    this.emit('change')
    return { survey: this.view(id, { owner: token }, now)!, token }
  }

  // Vote, or change this browser's vote.
  async vote(id: string, voter: unknown, body: unknown, now = Date.now()) {
    const entry = this.surveys.get(id)
    if (!entry) throw new SurveyError(404, 'There is no such survey.')
    if (!TOKEN.test(String(voter))) throw new SurveyError(400, 'Your browser has no voter id.')
    if (this.closedAt(entry, now) !== null) throw new SurveyError(409, 'This survey is closed.')

    const { survey } = entry
    const b = (body ?? {}) as Record<string, unknown>
    const picked = Array.isArray(b.choices) ? b.choices : []
    const choices = [...new Set(picked)].sort((x, y) => Number(x) - Number(y))
    const valid = choices.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < survey.options.length)
    if (!valid || choices.length === 0) throw new SurveyError(400, 'Pick an option.')
    if (!survey.multiple && choices.length > 1) throw new SurveyError(400, 'This survey takes one choice.')

    const vote: Vote = { voter: sha(String(voter)), choices: choices as number[], at: now }
    if (survey.named) {
      vote.name = (typeof b.name === 'string' && b.name.trim().slice(0, 32)) || 'Someone'
      vote.color = typeof b.color === 'string' && HEX.test(b.color) ? b.color : '#1d2a44'
    }
    // Deleted first, so a changed vote counts as this browser's latest.
    entry.votes.delete(vote.voter)
    entry.votes.set(vote.voter, vote)
    this.emit('change')
    await this.enqueue(id, () => appendFile(this.file(id, '.votes.jsonl'), `${JSON.stringify(vote)}\n`))
    return this.view(id, { voter }, now)!
  }

  // Stop voting now. Only the owner can.
  async close(id: string, owner: unknown, now = Date.now()) {
    const entry = this.owned(id, owner)
    if (this.closedAt(entry, now) === null) {
      entry.closedAt = now
      clearTimeout(entry.timer)
      this.emit('change')
      await this.enqueue(id, () => writeAtomic(this.file(id, '.closed'), String(now)))
    }
    return this.view(id, { owner }, now)!
  }

  // Deleted surveys go to DATA_DIR/.trash, like notes. Only the owner can delete one.
  async remove(id: string, owner: unknown) {
    const entry = this.owned(id, owner)
    this.surveys.delete(id)
    clearTimeout(entry.timer)
    this.emit('change')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await this.enqueue(id, async () => {
      for (const ext of ['.json', '.votes.jsonl', '.closed']) {
        await rename(this.file(id, ext), path.join(this.trashDir, `${stamp}--survey--${id}${ext}`)).catch(() => {})
      }
    })
  }

  async idle() {
    await Promise.allSettled(this.queues.values())
  }

  private file(id: string, ext: string) {
    return path.join(this.dir, `${id}${ext}`)
  }

  private isOwner(entry: Entry, token: unknown) {
    return typeof token === 'string' && TOKEN.test(token) && sha(token) === entry.survey.owner
  }

  private owned(id: string, owner: unknown) {
    const entry = this.surveys.get(id)
    if (!entry) throw new SurveyError(404, 'There is no such survey.')
    if (!this.isOwner(entry, owner)) throw new SurveyError(403, 'Only whoever published this survey can do that.')
    return entry
  }

  // Closed early by the owner, or at its deadline, whichever came first.
  private closedAt(entry: Entry, now: number) {
    const { closesAt } = entry.survey
    const deadline = closesAt !== null && closesAt <= now ? closesAt : null
    if (entry.closedAt === null) return deadline
    return deadline === null ? entry.closedAt : Math.min(entry.closedAt, deadline)
  }

  // Tell everyone when a survey closes at its deadline, so open pages and the index catch up.
  private schedule(entry: Entry) {
    const { closesAt } = entry.survey
    clearTimeout(entry.timer)
    if (closesAt === null || entry.closedAt !== null || closesAt <= Date.now()) return
    entry.timer = setTimeout(() => {
      if (Date.now() >= closesAt) this.emit('change')
      else this.schedule(entry)
    }, Math.min(closesAt - Date.now(), MAX_DELAY))
    entry.timer.unref()
  }

  private freshId() {
    let id = newId()
    while (this.surveys.has(id)) id = newId()
    return id
  }

  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(id) ?? Promise.resolve()).then(task)
    const settled = run.catch(() => {})
    this.queues.set(id, settled)
    settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return run
  }
}

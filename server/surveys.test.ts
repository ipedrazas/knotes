import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkDraft } from '../shared/survey.ts'
import { SurveyStore } from './surveys.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'knotes-surveys-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const NOW = Date.UTC(2026, 9, 15, 12)
const HOUR = 3_600_000
const ana = 'ana-browser-token-0001'
const bo = 'bo-browser-token-00002'
const draft = { question: 'Where to?', options: ['Beach', 'Hills', 'Town'], multiple: false, named: false, closesAt: null }

async function opened() {
  const store = new SurveyStore(dir)
  await store.init()
  return store
}

describe('checkDraft', () => {
  it('tidies a survey and drops blank options', () => {
    expect(checkDraft({ question: '  Where   to? ', options: [' Beach ', '', 'Hills'], multiple: true }, NOW)).toEqual({
      draft: { question: 'Where to?', options: ['Beach', 'Hills'], multiple: true, named: false, closesAt: null },
    })
  })

  it('says what is wrong', () => {
    expect(checkDraft({ question: '', options: ['a', 'b'] })).toEqual({ error: 'Ask a question.' })
    expect(checkDraft({ question: 'q', options: ['a', ' '] })).toEqual({ error: 'Give people at least two options.' })
    expect(checkDraft({ question: 'q', options: ['Beach', 'beach'] })).toEqual({ error: '“beach” is in there twice.' })
    expect(checkDraft({ question: 'q', options: ['a', 'b'], closesAt: NOW - 1 }, NOW)).toEqual({
      error: 'The closing time has to be in the future.',
    })
  })
})

describe('SurveyStore', () => {
  it('publishes a survey that only its owner token can close or delete', async () => {
    const store = await opened()
    const { survey, token } = await store.create(draft, 'trip', NOW)
    expect(survey).toMatchObject({ id: 'trip', question: 'Where to?', owner: true, closed: false, votes: 0 })
    expect(survey.results).toEqual({ counts: [0, 0, 0], voters: null })
    // The owner token itself is never written down.
    expect(await readFile(path.join(dir, 'surveys', 'trip.json'), 'utf8')).not.toContain(token)

    await expect(store.close('trip', 'not-the-owner-token-x')).rejects.toMatchObject({ status: 403 })
    await expect(store.remove('trip', undefined)).rejects.toMatchObject({ status: 403 })
    await expect(store.create(draft, 'trip', NOW)).rejects.toMatchObject({ status: 409 })
    await expect(store.create(draft, 'new', NOW)).rejects.toMatchObject({ status: 400 })
  })

  it('takes one vote per browser, which can change, and shows results only after voting', async () => {
    const store = await opened()
    await store.create(draft, 'trip', NOW)
    expect(store.view('trip', { voter: ana })).toMatchObject({ mine: null, results: null })

    await store.vote('trip', ana, { choices: [0] }, NOW)
    await store.vote('trip', bo, { choices: [0] }, NOW)
    const changed = await store.vote('trip', ana, { choices: [2] }, NOW + 1)
    expect(changed).toMatchObject({ mine: [2], votes: 2, results: { counts: [1, 0, 1], voters: null } })

    await expect(store.vote('trip', bo, { choices: [0, 1] }, NOW)).rejects.toMatchObject({ status: 400 })
    await expect(store.vote('trip', bo, { choices: [3] }, NOW)).rejects.toMatchObject({ status: 400 })
    await expect(store.vote('trip', bo, { choices: [] }, NOW)).rejects.toMatchObject({ status: 400 })
    await expect(store.vote('trip', 'short', { choices: [0] }, NOW)).rejects.toMatchObject({ status: 400 })
  })

  it('names voters only when the survey says so', async () => {
    const store = await opened()
    await store.create({ ...draft, multiple: true, named: true }, 'named', NOW)
    await store.create(draft, 'anon', NOW)
    const ink = { name: 'Ana', color: '#1f4aa8' }
    expect(await store.vote('named', ana, { choices: [0, 2], ...ink }, NOW)).toMatchObject({
      results: { counts: [1, 0, 1], voters: [[ink], [], [ink]] },
    })
    await store.vote('anon', ana, { choices: [1], ...ink }, NOW)
    await store.idle()
    expect(await readFile(path.join(dir, 'surveys', 'anon.votes.jsonl'), 'utf8')).not.toContain('Ana')
  })

  it('closes at its deadline or when the owner says, and then takes no votes', async () => {
    const store = await opened()
    await store.create({ ...draft, closesAt: NOW + HOUR }, 'timed', NOW)
    const { token } = await store.create(draft, 'manual', NOW)

    await store.vote('timed', ana, { choices: [1] }, NOW)
    await expect(store.vote('timed', bo, { choices: [1] }, NOW + HOUR)).rejects.toMatchObject({ status: 409 })
    // Once it's closed, everyone sees the results.
    expect(store.view('timed', { voter: bo }, NOW + HOUR)).toMatchObject({
      closed: true,
      closedAt: NOW + HOUR,
      results: { counts: [0, 1, 0] },
    })

    expect(await store.close('manual', token, NOW + 5)).toMatchObject({ closed: true, closedAt: NOW + 5 })
    await expect(store.vote('manual', ana, { choices: [0] }, NOW + 6)).rejects.toMatchObject({ status: 409 })
  })

  it('keeps surveys, votes and closing across restarts', async () => {
    const store = await opened()
    const { token } = await store.create(draft, 'trip', NOW)
    await store.vote('trip', ana, { choices: [0] }, NOW)
    await store.vote('trip', ana, { choices: [1] }, NOW + 1)
    await store.vote('trip', bo, { choices: [1] }, NOW + 2)
    await store.close('trip', token, NOW + 3)
    await store.idle()

    const restarted = await opened()
    expect(restarted.view('trip', { voter: ana, owner: token })).toMatchObject({
      owner: true,
      mine: [1],
      closed: true,
      closedAt: NOW + 3,
      results: { counts: [0, 2, 0] },
    })
    expect(restarted.list()).toEqual([{ id: 'trip', question: 'Where to?', votes: 2, closed: true, updatedAt: NOW + 3 }])
  })

  it('moves deleted surveys to the trash', async () => {
    const store = await opened()
    const { token } = await store.create(draft, 'trip', NOW)
    await store.vote('trip', ana, { choices: [0] }, NOW)
    await store.remove('trip', token)
    await store.idle()

    expect(store.has('trip')).toBe(false)
    expect(await readdir(path.join(dir, 'surveys'))).toEqual([])
    const trash = await readdir(path.join(dir, '.trash'))
    expect(trash.map((f) => f.replace(/^.*--survey--/, '')).sort()).toEqual(['trip.json', 'trip.votes.jsonl'])
  })
})

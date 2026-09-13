// Notes live on disk as plain markdown, one file per note, named after the note's title:
//
//   DATA_DIR/shopping-list--k3j9x0a2bc.md
//
// The id after `--` is the note's address (/n/k3j9x0a2bc); the slug in front follows the
// title and the file is renamed as the title changes. The id only changes when someone
// gives the note a new address, and the old one then redirects, through
// DATA_DIR/.knotes/moved.json. Markdown can't hold a Yjs history, and rebuilding a
// Y.Doc from markdown after every restart would duplicate text for any client that
// reconnects with its old state. So next to each note the store keeps the Yjs state in
// DATA_DIR/.knotes/<id>.yjs, with the hash of the markdown it was saved alongside. If
// the .md was edited by hand since (the hash no longer matches), the markdown wins.
import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { NOTE_ID, toAddress } from '../shared/address.ts'
import { FIELD } from '../shared/extensions.ts'
import { parseMarkdown, schema, summarize, toMarkdown } from './markdown.ts'

export interface NoteMeta {
  id: string
  title: string
  preview: string
  updatedAt: number
}

interface Entry extends NoteMeta {
  file: string
}

// Slugs never contain `--`, so the last one separates the slug from the id.
const FILE = /^(.*)--([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

const MOVED = 'moved.json'

export function slugify(title: string): string {
  return toAddress(title) || 'untitled'
}

const newId = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join('')
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

// Write to a temp file and rename over the target, so a crash never leaves half a note.
async function writeAtomic(file: string, data: string | Uint8Array) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export class NoteStore extends EventEmitter {
  private notes = new Map<string, Entry>()
  // Addresses notes used to have: old id → the note's id now.
  private moved = new Map<string, string>()
  // One write at a time per note: saves, renames and deletes for the same id queue up here.
  private queues = new Map<string, Promise<unknown>>()
  readonly dir: string
  readonly stateDir: string
  readonly trashDir: string

  constructor(dir: string) {
    super()
    this.dir = dir
    this.stateDir = path.join(dir, '.knotes')
    this.trashDir = path.join(dir, '.trash')
  }

  async init() {
    await mkdir(this.stateDir, { recursive: true })
    await mkdir(this.trashDir, { recursive: true })

    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.md') || name.startsWith('.')) continue
      const markdown = await readFile(path.join(this.dir, name), 'utf8')
      const { mtimeMs } = await stat(path.join(this.dir, name))
      const summary = summarize(parseMarkdown(markdown))
      let [, , id] = FILE.exec(name) ?? []
      let file = name
      if (!id || !NOTE_ID.test(id) || this.notes.has(id)) {
        // A markdown file dropped into the folder by hand: adopt it by giving it an id.
        id = this.freshId()
        file = `${slugify(summary.title || name.replace(/\.md$/, ''))}--${id}.md`
        await rename(path.join(this.dir, name), path.join(this.dir, file))
      }
      this.notes.set(id, { id, file, ...summary, updatedAt: Math.round(mtimeMs) })
    }

    try {
      const moved: unknown = JSON.parse(await readFile(path.join(this.stateDir, MOVED), 'utf8'))
      for (const [from, to] of Object.entries(moved ?? {})) {
        // A redirect only counts while its old address is free and its note still exists.
        if (typeof to === 'string' && this.notes.has(to) && !this.notes.has(from)) this.moved.set(from, to)
      }
    } catch {
      // No redirects yet.
    }
  }

  has(id: string) {
    return this.notes.has(id)
  }

  list(): NoteMeta[] {
    return [...this.notes.values()]
      .map(({ file: _file, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  fileOf(id: string) {
    const entry = this.notes.get(id)
    return entry && path.join(this.dir, entry.file)
  }

  // Where the note that used to live at this address is now.
  movedTo(id: string) {
    return this.moved.get(id)
  }

  redirects(): Record<string, string> {
    return Object.fromEntries(this.moved)
  }

  async create(): Promise<NoteMeta> {
    const id = this.freshId()
    const entry: Entry = { id, file: `untitled--${id}.md`, title: '', preview: '', updatedAt: Date.now() }
    await writeAtomic(path.join(this.dir, entry.file), '')
    this.notes.set(id, entry)
    this.emit('change')
    const { file: _file, ...meta } = entry
    return meta
  }

  // Fill a (fresh, empty) Y.Doc with the note's content.
  async load(id: string, ydoc: Y.Doc) {
    // A note that was just renamed may still be moving its files over.
    await this.queues.get(id)
    const entry = this.notes.get(id)
    if (!entry) throw new Error(`unknown note ${id}`)
    const markdown = await readFile(path.join(this.dir, entry.file), 'utf8')
    const state = await this.readState(id)
    if (state && state.hash === sha(markdown)) {
      Y.applyUpdate(ydoc, state.update)
      return
    }
    if (state) console.log(`[store] ${entry.file} changed on disk, rebuilding from markdown`)
    prosemirrorToYXmlFragment(parseMarkdown(markdown), ydoc.getXmlFragment(FIELD))
  }

  save(id: string, ydoc: Y.Doc) {
    return this.enqueue([id], async () => {
      const entry = this.notes.get(id)
      if (!entry) return // deleted or renamed while a save was pending
      const doc = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FIELD), schema)
      const markdown = toMarkdown(doc)
      const summary = summarize(doc)

      const file = `${slugify(summary.title)}--${id}.md`
      await writeAtomic(path.join(this.dir, file), markdown)
      if (file !== entry.file) await unlink(path.join(this.dir, entry.file)).catch(() => {})
      await writeAtomic(path.join(this.stateDir, `${id}.yjs`), Y.encodeStateAsUpdate(ydoc))
      await writeAtomic(path.join(this.stateDir, `${id}.sha`), sha(markdown))

      Object.assign(entry, summary, { file, updatedAt: Date.now() })
      this.emit('change')
    })
  }

  // Give a note a new id, and so a new address. The switch happens at once: from here on
  // the old id is unknown and redirects to the new one. If the note is open, pass its live
  // Y.Doc: content and Yjs state move with it, so whatever still reaches the old doc can
  // be merged into the new one without duplicating text.
  async rename(id: string, to: string, ydoc?: Y.Doc) {
    const entry = this.notes.get(id)
    if (!entry) throw new Error(`unknown note ${id}`)
    if (!NOTE_ID.test(to) || this.notes.has(to)) throw new Error(`cannot move ${id} to ${to}`)
    const doc = ydoc && yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FIELD), schema)
    const update = ydoc && Y.encodeStateAsUpdate(ydoc)

    this.notes.delete(id)
    this.notes.set(to, Object.assign(entry, { id: to }))
    for (const [from, now] of this.moved) if (now === id) this.moved.set(from, to)
    this.moved.set(id, to)
    this.moved.delete(to)
    this.saveRedirects()
    this.emit('change')

    // Queued under both ids, so nothing loads or saves the note as `to` before its files are there.
    await this.enqueue([id, to], async () => {
      const from = entry.file
      if (doc && update) {
        const markdown = toMarkdown(doc)
        const summary = summarize(doc)
        const file = `${slugify(summary.title)}--${to}.md`
        await writeAtomic(path.join(this.dir, file), markdown)
        await writeAtomic(path.join(this.stateDir, `${to}.yjs`), update)
        await writeAtomic(path.join(this.stateDir, `${to}.sha`), sha(markdown))
        await unlink(path.join(this.dir, from)).catch(() => {})
        await unlink(path.join(this.stateDir, `${id}.yjs`)).catch(() => {})
        await unlink(path.join(this.stateDir, `${id}.sha`)).catch(() => {})
        Object.assign(entry, summary, { file, updatedAt: Date.now() })
      } else {
        const file = from.replace(FILE, `$1--${to}.md`)
        await rename(path.join(this.dir, from), path.join(this.dir, file))
        await rename(path.join(this.stateDir, `${id}.yjs`), path.join(this.stateDir, `${to}.yjs`)).catch(() => {})
        await rename(path.join(this.stateDir, `${id}.sha`), path.join(this.stateDir, `${to}.sha`)).catch(() => {})
        entry.file = file
      }
      this.emit('change')
    })
  }

  // Deleted notes go to DATA_DIR/.trash rather than disappearing.
  remove(id: string) {
    return this.enqueue([id], async () => {
      const entry = this.notes.get(id)
      if (!entry) return false
      this.notes.delete(id)
      const redirects = this.moved.size
      for (const [from, now] of this.moved) if (now === id) this.moved.delete(from)
      if (this.moved.size !== redirects) this.saveRedirects()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await rename(path.join(this.dir, entry.file), path.join(this.trashDir, `${stamp}--${entry.file}`)).catch(() => {})
      await unlink(path.join(this.stateDir, `${id}.yjs`)).catch(() => {})
      await unlink(path.join(this.stateDir, `${id}.sha`)).catch(() => {})
      this.emit('change')
      return true
    })
  }

  async idle() {
    await Promise.allSettled(this.queues.values())
  }

  private freshId() {
    let id = newId()
    while (this.notes.has(id) || this.moved.has(id)) id = newId()
    return id
  }

  // Writes the redirects as they are when the write runs. Queued under a key no note id
  // can have, so two writes of the file never overlap.
  private saveRedirects() {
    this.enqueue(['.moved'], () =>
      writeAtomic(path.join(this.stateDir, MOVED), JSON.stringify(this.redirects(), null, 2)),
    ).catch((err) => console.error(`[store] cannot save redirects: ${(err as Error).message}`))
  }

  private async readState(id: string) {
    if (!NOTE_ID.test(id)) return null
    try {
      const [update, hash] = await Promise.all([
        readFile(path.join(this.stateDir, `${id}.yjs`)),
        readFile(path.join(this.stateDir, `${id}.sha`), 'utf8'),
      ])
      return { update: new Uint8Array(update), hash: hash.trim() }
    } catch {
      return null
    }
  }

  private enqueue<T>(ids: string[], task: () => Promise<T>): Promise<T> {
    const run = Promise.all(ids.map((id) => this.queues.get(id))).then(task)
    const settled = run.catch(() => {})
    for (const id of ids) this.queues.set(id, settled)
    settled.then(() => {
      for (const id of ids) if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return run
  }
}

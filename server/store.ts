// Notes live on disk as plain markdown, one file per note, named after the note's title:
//
//   DATA_DIR/shopping-list--k3j9x0a2bc.md
//
// The id after `--` is stable; the slug in front follows the title and the file is
// renamed as the title changes. Markdown can't hold a Yjs history, and rebuilding a
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
import { FIELD, NOTE_ID } from '../shared/extensions.ts'
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

const FILE = /^(.*)--([a-z0-9]{10})\.md$/

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'untitled'
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
  // One write at a time per note: saves and deletes for the same id queue up here.
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
      if (!id || this.notes.has(id)) {
        // A markdown file dropped into the folder by hand: adopt it by giving it an id.
        id = newId()
        file = `${slugify(summary.title || name.replace(/\.md$/, ''))}--${id}.md`
        await rename(path.join(this.dir, name), path.join(this.dir, file))
      }
      this.notes.set(id, { id, file, ...summary, updatedAt: Math.round(mtimeMs) })
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

  async create(): Promise<NoteMeta> {
    const id = newId()
    const entry: Entry = { id, file: `untitled--${id}.md`, title: '', preview: '', updatedAt: Date.now() }
    await writeAtomic(path.join(this.dir, entry.file), '')
    this.notes.set(id, entry)
    this.emit('change')
    const { file: _file, ...meta } = entry
    return meta
  }

  // Fill a (fresh, empty) Y.Doc with the note's content.
  async load(id: string, ydoc: Y.Doc) {
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
    return this.enqueue(id, async () => {
      const entry = this.notes.get(id)
      if (!entry) return // deleted while a save was pending
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

  // Deleted notes go to DATA_DIR/.trash rather than disappearing.
  remove(id: string) {
    return this.enqueue(id, async () => {
      const entry = this.notes.get(id)
      if (!entry) return false
      this.notes.delete(id)
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

  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(id) ?? Promise.resolve()).then(task, task)
    const settled = run.catch(() => {})
    this.queues.set(id, settled)
    settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return run
  }
}

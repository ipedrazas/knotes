import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { FIELD } from '../shared/extensions.ts'
import { parseMarkdown, schema, toMarkdown } from './markdown.ts'
import { NoteStore, slugify } from './store.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'knotes-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const docFrom = (md: string) => {
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(parseMarkdown(md), ydoc.getXmlFragment(FIELD))
  return ydoc
}
const markdownOf = (ydoc: Y.Doc) => toMarkdown(yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FIELD), schema))
const notes = async () => (await readdir(dir)).filter((f) => f.endsWith('.md'))

describe('slugify', () => {
  it('makes file-name-safe slugs', () => {
    expect(slugify('Café & Crème: plans!')).toBe('cafe-creme-plans')
    expect(slugify('')).toBe('untitled')
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
  })
})

describe('NoteStore', () => {
  it('creates, saves under the title, and renames as the title changes', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    expect(await notes()).toEqual([`untitled--${id}.md`])

    await store.save(id, docFrom('# Groceries\n\neggs\n'))
    expect(await notes()).toEqual([`groceries--${id}.md`])
    expect(await readFile(path.join(dir, `groceries--${id}.md`), 'utf8')).toBe('# Groceries\n\neggs\n')
    expect(store.list()[0]).toMatchObject({ id, title: 'Groceries', preview: 'eggs' })

    await store.save(id, docFrom('Weekend\n'))
    expect(await notes()).toEqual([`weekend--${id}.md`])
  })

  it('reloads the saved Yjs state so reconnecting clients merge cleanly', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    const original = docFrom('hello\n')
    await store.save(id, original)

    const restarted = new NoteStore(dir)
    await restarted.init()
    const loaded = new Y.Doc()
    await restarted.load(id, loaded)

    // A client still holding `original` syncs with the reloaded doc: no duplicate text.
    Y.applyUpdate(loaded, Y.encodeStateAsUpdate(original))
    expect(markdownOf(loaded)).toBe('hello\n')
  })

  it('rebuilds from markdown when the file was edited by hand', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    await store.save(id, docFrom('before\n'))
    await writeFile(path.join(dir, `before--${id}.md`), 'after\n')

    const loaded = new Y.Doc()
    await store.load(id, loaded)
    expect(markdownOf(loaded)).toBe('after\n')
  })

  it('adopts markdown files dropped into the folder', async () => {
    await writeFile(path.join(dir, 'Recipe ideas.md'), '# Pancakes\n')
    const store = new NoteStore(dir)
    await store.init()
    const [note] = store.list()
    expect(note.title).toBe('Pancakes')
    expect(await notes()).toEqual([`pancakes--${note.id}.md`])
  })

  it('moves deleted notes to the trash and ignores late saves', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    await store.save(id, docFrom('bye\n'))
    expect(await store.remove(id)).toBe(true)
    await store.save(id, docFrom('ghost\n'))

    expect(await notes()).toEqual([])
    expect(store.has(id)).toBe(false)
    const trash = await readdir(path.join(dir, '.trash'))
    expect(trash).toHaveLength(1)
    expect(trash[0]).toMatch(new RegExp(`bye--${id}\\.md$`))
  })
})

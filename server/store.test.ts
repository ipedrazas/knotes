import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { toAddress } from '../shared/address.ts'
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
const addParagraph = (ydoc: Y.Doc, text: string) => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  ydoc.getXmlFragment(FIELD).push([p])
}

describe('slugify', () => {
  it('makes file-name-safe slugs', () => {
    expect(slugify('Café & Crème: plans!')).toBe('cafe-creme-plans')
    expect(slugify('')).toBe('untitled')
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
  })

  it('turns what people type into addresses', () => {
    expect(toAddress('  My Party! ')).toBe('my-party')
    expect(toAddress('--a--b--')).toBe('a-b')
    expect(toAddress('!!!')).toBe('')
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

  it('gives a note a new address and redirects the old one, across restarts', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    await store.save(id, docFrom('# Party\n\nbring cake\n'))
    await store.rename(id, 'my-party')

    expect(await notes()).toEqual(['party--my-party.md'])
    expect(store.has(id)).toBe(false)
    expect(store.list()[0]).toMatchObject({ id: 'my-party', title: 'Party' })
    expect(store.movedTo(id)).toBe('my-party')

    await store.idle()
    const restarted = new NoteStore(dir)
    await restarted.init()
    expect(restarted.list().map((n) => n.id)).toEqual(['my-party'])
    expect(restarted.movedTo(id)).toBe('my-party')
    const loaded = new Y.Doc()
    await restarted.load('my-party', loaded)
    expect(markdownOf(loaded)).toBe('# Party\n\nbring cake\n')
  })

  it('moves an open note with its live content, so late edits merge without duplicates', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const { id } = await store.create()
    const live = docFrom('saved\n')
    await store.save(id, live)
    addParagraph(live, 'typed before the move')
    await store.rename(id, 'moved', live)
    addParagraph(live, 'typed after the move')

    const loaded = new Y.Doc()
    await store.load('moved', loaded)
    expect(markdownOf(loaded)).not.toContain('after')
    Y.applyUpdate(loaded, Y.encodeStateAsUpdate(live))
    expect(markdownOf(loaded)).toBe(markdownOf(live))
    expect(markdownOf(loaded).match(/saved/g)).toHaveLength(1)
  })

  it('refuses an address another note has', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const a = await store.create()
    const b = await store.create()
    await expect(store.rename(a.id, b.id)).rejects.toThrow()
    await expect(store.rename(a.id, 'Not Valid')).rejects.toThrow()
    expect(store.has(a.id)).toBe(true)
  })

  it('drops redirects when the old address is reused or the note is deleted', async () => {
    const store = new NoteStore(dir)
    await store.init()
    const a = await store.create()
    const b = await store.create()
    await store.rename(a.id, 'party')
    await store.rename('party', 'big-party')
    expect(store.redirects()).toEqual({ [a.id]: 'big-party', party: 'big-party' })

    await store.rename(b.id, 'party')
    expect(store.redirects()).toEqual({ [a.id]: 'big-party', [b.id]: 'party' })

    await store.remove('big-party')
    await store.idle()
    expect(store.redirects()).toEqual({ [b.id]: 'party' })
    expect(JSON.parse(await readFile(path.join(dir, '.knotes', 'moved.json'), 'utf8'))).toEqual({ [b.id]: 'party' })
  })
})

import { describe, expect, it } from 'vitest'
import { parseMarkdown, summarize, toMarkdown } from './markdown.ts'

const roundTrip = (md: string) => toMarkdown(parseMarkdown(md))

describe('markdown', () => {
  it('round-trips the formatting the editor supports', () => {
    const md = [
      '# Shopping',
      '',
      'Some **bold**, *italic*, ~~struck~~ and `code`, plus a [link](https://andcake.dev).',
      '',
      '## Lists',
      '',
      '- eggs',
      '- milk',
      '  - semi-skimmed',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] flour',
      '- [x] sugar',
      '',
      '> a quote',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '---',
      '',
      'line one\\',
      'line two',
      '',
    ].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('reads task lists into task items', () => {
    const doc = parseMarkdown('- [ ] todo\n- [X] done\n').toJSON()
    expect(doc.content[0].type).toBe('taskList')
    expect(doc.content[0].content.map((i: { attrs: { checked: boolean } }) => i.attrs.checked)).toEqual([false, true])
    expect(doc.content[0].content[0].content[0].content[0].text).toBe('todo')
  })

  it('leaves mixed lists as bullet lists', () => {
    const doc = parseMarkdown('- [ ] todo\n- plain\n').toJSON()
    expect(doc.content[0].type).toBe('bulletList')
  })

  it('keeps an empty task item', () => {
    expect(roundTrip('- [ ] \n- [x] done\n')).toBe('- [ ] \n- [x] done\n')
  })

  it('treats raw HTML and images as text rather than dropping or rendering them', () => {
    const doc = parseMarkdown('<script>alert(1)</script>\n\n![cat](cat.png)\n')
    expect(doc.textContent).toContain('<script>alert(1)</script>')
    expect(doc.textContent).toContain('!cat')
  })

  it('handles an empty note', () => {
    expect(roundTrip('')).toBe('')
  })

  it('takes the title and preview from the first two non-empty lines', () => {
    expect(summarize(parseMarkdown('\n# My  note\n\n\nfirst line\n\nsecond\n'))).toEqual({
      title: 'My note',
      preview: 'first line',
    })
    expect(summarize(parseMarkdown(''))).toEqual({ title: '', preview: '' })
  })
})

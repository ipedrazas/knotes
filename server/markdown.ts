// Markdown <-> ProseMirror for the node and mark types in shared/extensions.ts.
//
// prosemirror-markdown does the heavy lifting; the token and node names below just map
// markdown-it's snake_case vocabulary onto TipTap's camelCase schema. Task lists are not
// CommonMark, so a small markdown-it rule turns `- [ ] ` / `- [x] ` items into task tokens.
import MarkdownIt from 'markdown-it'
import { MarkdownParser, MarkdownSerializer, defaultMarkdownSerializer as d } from 'prosemirror-markdown'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { noteExtensions } from '../shared/extensions.ts'

export const schema = getSchema(noteExtensions)

type Md = ReturnType<typeof MarkdownIt>
type Token = ReturnType<Md['parse']>[number]

const TASK = /^\[([ xX])\](?:[ \t]+|$)/

function findClose(tokens: Token[], open: number, type: string): number {
  for (let i = open + 1; i < tokens.length; i++) {
    if (tokens[i].type === type && tokens[i].level === tokens[open].level) return i
  }
  return -1
}

// Drop the first `n` characters of an inline token's text, across its children.
function stripPrefix(inline: Token, n: number) {
  inline.content = inline.content.slice(n)
  for (const child of inline.children ?? []) {
    if (n <= 0) break
    if (child.type !== 'text') break
    const take = Math.min(n, child.content.length)
    child.content = child.content.slice(take)
    n -= take
  }
}

function taskLists(md: Md) {
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'bullet_list_open') continue
      const close = findClose(tokens, i, 'bullet_list_close')
      const items: number[] = []
      for (let j = i + 1; j < close; j++) {
        if (tokens[j].type === 'list_item_open' && tokens[j].level === tokens[i].level + 1) items.push(j)
      }
      // list_item_open, paragraph_open, inline — only convert lists made entirely of tasks.
      const isTask = (j: number) => tokens[j + 1]?.type === 'paragraph_open' && TASK.test(tokens[j + 2]?.content ?? '')
      if (items.length === 0 || !items.every(isTask)) continue

      tokens[i].type = 'task_list_open'
      tokens[close].type = 'task_list_close'
      for (const j of items) {
        const inline = tokens[j + 2]
        const match = TASK.exec(inline.content)!
        tokens[j].type = 'task_item_open'
        tokens[j].attrSet('checked', match[1] === ' ' ? 'false' : 'true')
        tokens[findClose(tokens, j, 'list_item_close')].type = 'task_item_close'
        stripPrefix(inline, match[0].length)
      }
    }
  })
}

const md = MarkdownIt('commonmark', { html: false }).enable('strikethrough').disable('image').use(taskLists)

const parser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList' },
  ordered_list: { block: 'orderedList', getAttrs: (t) => ({ start: Number(t.attrGet('start')) || 1 }) },
  task_list: { block: 'taskList' },
  task_item: { block: 'taskItem', getAttrs: (t) => ({ checked: t.attrGet('checked') === 'true' }) },
  heading: { block: 'heading', getAttrs: (t) => ({ level: Number(t.tag.slice(1)) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: { block: 'codeBlock', getAttrs: (t) => ({ language: t.info.trim() || null }), noCloseToken: true },
  hr: { node: 'horizontalRule' },
  hardbreak: { node: 'hardBreak' },
  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  s: { mark: 'strike' },
  link: { mark: 'link', getAttrs: (t) => ({ href: t.attrGet('href'), title: t.attrGet('title') || null }) },
  code_inline: { mark: 'code', noCloseToken: true },
})

const serializer = new MarkdownSerializer(
  {
    paragraph: d.nodes.paragraph,
    text: d.nodes.text,
    heading: d.nodes.heading,
    blockquote: d.nodes.blockquote,
    horizontalRule: d.nodes.horizontal_rule,
    hardBreak: d.nodes.hard_break,
    listItem: d.nodes.list_item,
    taskItem: d.nodes.list_item,
    codeBlock(state, node) {
      const backticks = node.textContent.match(/`{3,}/gm)
      const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```'
      state.write(fence + (node.attrs.language || '') + '\n')
      state.text(node.textContent, false)
      state.write('\n')
      state.write(fence)
      state.closeBlock(node)
    },
    bulletList(state, node) {
      state.renderList(node, '  ', () => '- ')
    },
    orderedList(state, node) {
      const start: number = node.attrs.start || 1
      const width = String(start + node.childCount - 1).length
      state.renderList(node, state.repeat(' ', width + 2), (i) => {
        const n = String(start + i)
        return state.repeat(' ', width - n.length) + n + '. '
      })
    },
    taskList(state, node) {
      state.renderList(node, '  ', (i) => (node.child(i).attrs.checked ? '- [x] ' : '- [ ] '))
    },
  },
  {
    italic: d.marks.em,
    bold: d.marks.strong,
    link: d.marks.link,
    code: d.marks.code,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
)

export function parseMarkdown(markdown: string): PMNode {
  return parser.parse(markdown)
}

export function toMarkdown(doc: PMNode): string {
  const out = serializer.serialize(doc, { tightLists: true })
  return out ? out + '\n' : ''
}

// Like Apple Notes: the first line is the title, the next non-empty line the preview.
export function summarize(doc: PMNode): { title: string; preview: string } {
  const lines: string[] = []
  doc.descendants((node) => {
    if (lines.length >= 2) return false
    if (node.isTextblock) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) lines.push(text)
      return false
    }
    return true
  })
  return { title: (lines[0] ?? '').slice(0, 120), preview: (lines[1] ?? '').slice(0, 160) }
}

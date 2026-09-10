import type { ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'

// Markdown shortcuts work too (`# `, `- `, `[ ] `, `> `, ``` and friends); this is for
// everything else.
export function Toolbar({ editor }: { editor: Editor | null }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'),
      },
  })
  if (!editor || !on) return <div className="tools" />

  const chain = () => editor.chain().focus()

  function link() {
    const previous = editor!.getAttributes('link').href ?? ''
    const href = prompt('Link to', previous)
    if (href === null) return
    if (href.trim() === '') chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }

  return (
    <div className="tools" role="toolbar" aria-label="Formatting">
      <Tool label="Title" active={on.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <span className="tool__title">Title</span>
      </Tool>
      <Tool label="Heading" active={on.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <span className="tool__heading">Heading</span>
      </Tool>
      <span className="tools__sep" />
      <Tool label="Bold" active={on.bold} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </Tool>
      <Tool label="Italic" active={on.italic} onClick={() => chain().toggleItalic().run()}>
        <i>I</i>
      </Tool>
      <Tool label="Strikethrough" active={on.strike} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </Tool>
      <Tool label="Code" active={on.code} onClick={() => chain().toggleCode().run()}>
        <code>{'</>'}</code>
      </Tool>
      <Tool label="Link" active={on.link} onClick={link}>
        ∞
      </Tool>
      <span className="tools__sep" />
      <Tool label="Checklist" active={on.task} onClick={() => chain().toggleTaskList().run()}>
        ☑
      </Tool>
      <Tool label="Bulleted list" active={on.bullet} onClick={() => chain().toggleBulletList().run()}>
        •≡
      </Tool>
      <Tool label="Numbered list" active={on.ordered} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label="Quote" active={on.quote} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </Tool>
      <Tool label="Code block" active={on.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        {'{ }'}
      </Tool>
      <Tool label="Divider" active={false} onClick={() => chain().setHorizontalRule().run()}>
        ~
      </Tool>
    </div>
  )
}

function Tool(props: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={props.active ? 'tool is-on' : 'tool'}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      // Keep the editor's selection: act on mouse up without stealing focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

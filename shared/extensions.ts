// The document schema, shared by the editor in the browser and by the server, which
// converts notes between Yjs and markdown. Anything that adds or removes a node or
// mark type here also needs a rule in server/markdown.ts.
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'

export const noteExtensions = [
  StarterKit.configure({
    // Yjs brings its own collaborative undo; underline has no markdown syntax.
    undoRedo: false,
    underline: false,
    link: { openOnClick: false, autolink: true },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
]

// Name of the Y.XmlFragment that holds the note inside each Y.Doc.
export const FIELD = 'default'

export const NOTE_ID = /^[a-z0-9]{10}$/

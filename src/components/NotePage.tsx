import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { EditorContent, useEditor } from '@tiptap/react'
import { Collaboration, isChangeOrigin } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import { FIELD, noteExtensions } from '../../shared/extensions.ts'
import { collabUrl, deleteNote, longDate, navigate, type NoteMeta } from '../api.ts'
import { safeColor, type User } from '../user.ts'
import { Blots, namesOf } from './Blots.tsx'
import { Toolbar } from './Toolbar.tsx'

interface Props {
  id: string
  meta: NoteMeta | undefined
  user: User
  onGone: (message: string) => void
}

interface Conn {
  doc: Y.Doc
  provider: HocuspocusProvider
}

// One Y.Doc and one websocket per open note, torn down when you leave it.
export function NotePage(props: Props) {
  const [conn, setConn] = useState<Conn | null>(null)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new HocuspocusProvider({ url: collabUrl(), name: props.id, document: doc })
    setConn({ doc, provider })
    return () => {
      provider.destroy()
      doc.destroy()
    }
  }, [props.id])

  if (!conn) return <section className="sheet" />
  return <Note {...props} {...conn} />
}

type Status = 'opening' | 'synced' | 'saving' | 'offline'

const STATUS_LABEL: Record<Status, string> = {
  opening: 'Opening',
  synced: 'Synced',
  saving: 'Saving',
  offline: 'Offline',
}

function Note({ id, meta, user, onGone, doc, provider }: Props & Conn) {
  const editor = useEditor(
    {
      extensions: [
        ...noteExtensions,
        Placeholder.configure({ placeholder: ({ pos }) => (pos === 0 ? 'Title' : 'Write something…') }),
        Collaboration.configure({ document: doc, field: FIELD }),
        CollaborationCaret.configure({ provider, user, render: renderCaret, selectionRender }),
      ],
      editorProps: { attributes: { class: 'writing', 'aria-label': 'Note', spellcheck: 'true' } },
    },
    [doc, provider],
  )

  const status = useStatus(provider)
  const peers = usePeers(provider, doc.clientID)
  const writing = peers.filter((p) => p.typing)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const onFailed = () => setMissing(true)
    provider.on('authenticationFailed', onFailed)
    return () => {
      provider.off('authenticationFailed', onFailed)
    }
  }, [provider])

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.updateUser(user)
  }, [editor, user])

  // Tell everyone else we're writing. Remote changes don't count, and a stamp every
  // 800ms is plenty for a "writing…" that lingers for a couple of seconds.
  useEffect(() => {
    if (!editor) return
    let last = 0
    const onUpdate = ({ transaction }: { transaction: Parameters<typeof isChangeOrigin>[0] }) => {
      if (isChangeOrigin(transaction)) return
      const now = Date.now()
      if (now - last < 800) return
      last = now
      provider.setAwarenessField('typingAt', now)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, provider])

  async function tearOut() {
    if (!confirm('Tear this page out of the notebook? It goes to the trash folder on the server.')) return
    try {
      await deleteNote(id)
      onGone('Page torn out.')
      navigate('/')
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (missing) {
    return (
      <section className="sheet sheet--blank">
        <div className="blank">
          <p className="blank__hand">This page isn't in the notebook.</p>
          <button className="stamp-btn" onClick={() => navigate('/')}>
            Back to the index
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="sheet" aria-label={meta?.title || 'Untitled note'}>
      <header className="sheet__head">
        <button className="back" onClick={() => navigate('/')}>
          ‹ Index
        </button>
        <div className="sheet__when">
          {meta && <time className="sheet__date">{longDate(meta.updatedAt)}</time>}
          <p className="writing-now" aria-live="polite">
            {writing.length > 0 ? (
              <>
                <span className="writing-now__pen">✎</span> {namesOf(writing)} {writing.length === 1 ? 'is' : 'are'}{' '}
                writing<span className="dots" />
              </>
            ) : peers.length > 0 ? (
              `${namesOf(peers)} ${peers.length === 1 ? 'is' : 'are'} here too`
            ) : (
              'Just you on this page'
            )}
          </p>
        </div>
        <Blots people={peers} />
        <span className={`stamp stamp--${status}`}>{STATUS_LABEL[status]}</span>
        <div className="sheet__actions">
          <a className="tool" href={`/api/notes/${id}/markdown`} download title="Download as markdown">
            ⤓ .md
          </a>
          <button className="tool tool--danger" onClick={tearOut} title="Delete this note">
            Tear out
          </button>
        </div>
      </header>
      <Toolbar editor={editor} />
      <div className="paper">
        <EditorContent editor={editor} className="paper__lines" />
      </div>
    </section>
  )
}

function useStatus(provider: HocuspocusProvider): Status {
  const [status, setStatus] = useState<Status>('opening')

  useEffect(() => {
    let connected = provider.configuration.websocketProvider.status === 'connected'
    let everSynced = false
    const update = () => {
      if (provider.isSynced) everSynced = true
      if (!connected || !provider.isSynced) setStatus(everSynced ? 'offline' : 'opening')
      else setStatus(provider.hasUnsyncedChanges ? 'saving' : 'synced')
    }
    const onStatus = ({ status }: { status: string }) => {
      connected = status === 'connected'
      update()
    }
    provider.on('status', onStatus)
    provider.on('synced', update)
    provider.on('unsyncedChanges', update)
    update()
    return () => {
      provider.off('status', onStatus)
      provider.off('synced', update)
      provider.off('unsyncedChanges', update)
    }
  }, [provider])

  return status
}

interface Peer {
  clientId: number
  name: string
  color: string
  typing: boolean
}

// Everyone else on this page, from Yjs awareness. Someone counts as typing for 2.5s
// after their `typingAt` stamp last changed — measured on our clock, not theirs.
function usePeers(provider: HocuspocusProvider, selfId: number): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    const seen = new Map<number, { typingAt: unknown; since: number }>()
    let last = ''
    const compute = () => {
      const now = Date.now()
      const next: Peer[] = []
      provider.awareness?.getStates().forEach((state, clientId) => {
        if (clientId === selfId || typeof state?.user?.name !== 'string') return
        const prev = seen.get(clientId)
        const since = !prev ? 0 : prev.typingAt === state.typingAt ? prev.since : now
        seen.set(clientId, { typingAt: state.typingAt, since })
        next.push({ clientId, name: state.user.name, color: safeColor(state.user.color), typing: now - since < 2500 })
      })
      const key = JSON.stringify(next)
      if (key !== last) {
        last = key
        setPeers(next)
      }
    }
    provider.on('awarenessChange', compute)
    const tick = setInterval(compute, 500)
    compute()
    return () => {
      provider.off('awarenessChange', compute)
      clearInterval(tick)
    }
  }, [provider, selfId])

  return peers
}

// Other people's cursors: a stroke of their ink with a name tag.
function renderCaret(user: Record<string, unknown>) {
  const caret = document.createElement('span')
  caret.className = 'ink-caret'
  caret.style.setProperty('--c', safeColor(user.color))
  const label = document.createElement('span')
  label.className = 'ink-caret__label'
  label.textContent = String(user.name ?? 'Someone')
  caret.append(label)
  return caret
}

function selectionRender(user: Record<string, unknown>) {
  return { nodeName: 'span', class: 'ink-selection', style: `background-color: ${safeColor(user.color)}2e` }
}

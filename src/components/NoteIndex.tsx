import type { CSSProperties } from 'react'
import { navigate, shortDate, type NoteMeta, type Writer } from '../api.ts'
import { safeColor, type User } from '../user.ts'
import { Blots } from './Blots.tsx'

interface Props {
  notes: NoteMeta[]
  total: number
  loaded: boolean
  presence: Record<string, Writer[]>
  activeId: string | null
  query: string
  onQuery: (q: string) => void
  onNew: () => void
  user: User | null
  onEditUser: () => void
  connected: boolean
}

// The notebook's cover, with the contents pasted inside it.
export function NoteIndex(props: Props) {
  const { notes, presence, activeId } = props

  return (
    <aside className="cover" aria-label="Notes">
      <header className="cover__label">
        <h1>knotes</h1>
        <p>a shared notebook</p>
      </header>

      <div className="cover__tools">
        <input
          className="search"
          type="search"
          placeholder="Search…"
          aria-label="Search notes"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
        <button className="stamp-btn" onClick={props.onNew}>
          + New
        </button>
      </div>

      <nav className="contents">
        {props.loaded && notes.length === 0 && (
          <p className="contents__empty">
            {props.total === 0 ? 'Not a single page yet. Start one!' : 'Nothing matches that.'}
          </p>
        )}
        <ul>
          {notes.map((note) => {
            const writers = presence[note.id] ?? []
            const typing = writers.some((w) => w.typing)
            return (
              <li key={note.id}>
                <a
                  href={`/n/${note.id}`}
                  className={note.id === activeId ? 'entry is-active' : 'entry'}
                  aria-current={note.id === activeId ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return
                    e.preventDefault()
                    navigate(`/n/${note.id}`)
                  }}
                >
                  <span className="entry__title">
                    {typing && (
                      <span className="entry__pen" aria-label="someone is writing">
                        ✎
                      </span>
                    )}
                    <span className="entry__text">{note.title || 'Untitled'}</span>
                  </span>
                  <span className="entry__meta">
                    <time dateTime={new Date(note.updatedAt).toISOString()}>{shortDate(note.updatedAt)}</time>
                    <span className="entry__preview">{note.preview}</span>
                  </span>
                  <Blots people={writers} small />
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <footer className="cover__footer">
        {props.user && (
          <button className="me" onClick={props.onEditUser} title="Change your name or ink">
            <span className="me__ink" style={{ '--c': safeColor(props.user.color) } as CSSProperties} />
            {props.user.name}
          </button>
        )}
        <span
          className={props.connected ? 'wire is-on' : 'wire'}
          title={props.connected ? 'Live' : 'Reconnecting…'}
          aria-label={props.connected ? 'Live' : 'Reconnecting'}
        />
      </footer>
    </aside>
  )
}

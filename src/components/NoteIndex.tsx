import type { CSSProperties, MouseEvent } from 'react'
import type { SurveyMeta } from '../../shared/survey.ts'
import { navigate, shortDate, type NoteMeta, type Writer } from '../api.ts'
import { safeColor, type User } from '../user.ts'
import { Blots } from './Blots.tsx'

interface Props {
  notes: NoteMeta[]
  surveys: SurveyMeta[]
  total: number
  loaded: boolean
  presence: Record<string, Writer[]>
  activeId: string | null
  activeSurveyId: string | null
  query: string
  onQuery: (q: string) => void
  onNew: () => void
  onNewSurvey: () => void
  user: User | null
  onEditUser: () => void
  connected: boolean
}

// Follow a link in the index without reloading, unless it's meant for a new tab.
const follow = (path: string) => (e: MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  navigate(path)
}

// The notebook's cover, with the contents pasted inside it: notes and surveys, the most
// recently touched first.
export function NoteIndex(props: Props) {
  const { notes, surveys, presence, activeId, activeSurveyId } = props
  const entries = [
    ...notes.map((note) => ({ kind: 'note' as const, note, at: note.updatedAt })),
    ...surveys.map((survey) => ({ kind: 'survey' as const, survey, at: survey.updatedAt })),
  ].sort((a, b) => b.at - a.at)

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
        <button className="stamp-btn" onClick={props.onNew} title="Start a new page">
          + Page
        </button>
        <button className="stamp-btn" onClick={props.onNewSurvey} title="Ask everyone a question">
          + Survey
        </button>
      </div>

      <nav className="contents">
        {props.loaded && entries.length === 0 && (
          <p className="contents__empty">
            {props.total === 0 ? 'Not a single page yet. Start one!' : 'Nothing matches that.'}
          </p>
        )}
        <ul>
          {entries.map((entry) => {
            if (entry.kind === 'survey') {
              const { survey } = entry
              const active = survey.id === activeSurveyId
              return (
                <li key={`s:${survey.id}`}>
                  <a
                    href={`/s/${survey.id}`}
                    className={active ? 'entry entry--survey is-active' : 'entry entry--survey'}
                    aria-current={active ? 'page' : undefined}
                    onClick={follow(`/s/${survey.id}`)}
                  >
                    <span className="entry__title">
                      <span className="entry__mark" aria-label="Survey">
                        ☑
                      </span>
                      <span className="entry__text">{survey.question}</span>
                    </span>
                    <span className="entry__meta">
                      <time dateTime={new Date(survey.updatedAt).toISOString()}>{shortDate(survey.updatedAt)}</time>
                      <span className="entry__preview">
                        {survey.votes} vote{survey.votes === 1 ? '' : 's'}
                        {survey.closed ? ' · closed' : ''}
                      </span>
                    </span>
                  </a>
                </li>
              )
            }
            const { note } = entry
            const writers = presence[note.id] ?? []
            const typing = writers.some((w) => w.typing)
            return (
              <li key={`n:${note.id}`}>
                <a
                  href={`/n/${note.id}`}
                  className={note.id === activeId ? 'entry is-active' : 'entry'}
                  aria-current={note.id === activeId ? 'page' : undefined}
                  onClick={follow(`/n/${note.id}`)}
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

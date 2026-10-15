import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createNote,
  navigate,
  NEW_SURVEY,
  noteIdFrom,
  surveyIdFrom,
  useLiveIndex,
  usePath,
  type NoteMeta,
} from './api.ts'
import { loadUser, saveUser, type User } from './user.ts'
import { NoteIndex } from './components/NoteIndex.tsx'
import { NewSurvey } from './components/NewSurvey.tsx'
import { NotePage } from './components/NotePage.tsx'
import { SurveyPage } from './components/SurveyPage.tsx'
import { WhoCard } from './components/WhoCard.tsx'

export function App() {
  const [user, setUser] = useState<User | null>(loadUser)
  const [editingUser, setEditingUser] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // A note we just created, shown until the live index catches up with it.
  const [fresh, setFresh] = useState<NoteMeta | null>(null)
  const live = useLiveIndex()
  const path = usePath()
  const noteId = noteIdFrom(path)
  const surveyId = surveyIdFrom(path)
  const writingSurvey = path === NEW_SURVEY

  const notes = useMemo(
    () => (fresh && !live.notes.some((n) => n.id === fresh.id) ? [fresh, ...live.notes] : live.notes),
    [fresh, live.notes],
  )
  const current = notes.find((n) => n.id === noteId)
  const currentSurvey = live.surveys.find((s) => s.id === surveyId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? notes.filter((n) => `${n.title}\n${n.preview}`.toLowerCase().includes(q)) : notes
  }, [notes, query])

  const filteredSurveys = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? live.surveys.filter((s) => s.question.toLowerCase().includes(q)) : live.surveys
  }, [live.surveys, query])

  useEffect(() => {
    if (path !== '/' && !noteId && !surveyId && !writingSurvey) navigate('/', true)
  }, [path, noteId, surveyId, writingSurvey])

  // Once the live index has the note we created, it's the index's to show. Holding on
  // to it would bring it back as a ghost after it's renamed or torn out.
  useEffect(() => {
    if (fresh && live.notes.some((n) => n.id === fresh.id)) setFresh(null)
  }, [fresh, live.notes])

  // The page we're on (or the link we followed) moved to a new address: follow it.
  // Someone else tore it out: go back to the index.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    if (!live.loaded) return
    for (const n of live.notes) seen.current.add(n.id)
    for (const s of live.surveys) seen.current.add(`s:${s.id}`)
    if (surveyId && !live.surveys.some((s) => s.id === surveyId) && seen.current.has(`s:${surveyId}`)) {
      setNotice('That survey was torn out of the notebook.')
      navigate('/', true)
      return
    }
    if (!noteId || live.notes.some((n) => n.id === noteId)) return
    const movedTo = live.moved[noteId]
    if (movedTo) {
      navigate(`/n/${movedTo}`, true)
    } else if (seen.current.has(noteId)) {
      setNotice('That page was torn out of the notebook.')
      navigate('/', true)
    }
  }, [live.loaded, live.notes, live.moved, live.surveys, noteId, surveyId])

  // Survey pages set their own title.
  useEffect(() => {
    if (surveyId || writingSurvey) return
    document.title = current ? `${current.title || 'Untitled'} · knotes` : 'knotes'
  }, [current, surveyId, writingSurvey])

  useEffect(() => {
    if (noteId || surveyId || writingSurvey) setNotice(null)
  }, [noteId, surveyId, writingSurvey])

  async function newNote() {
    try {
      const note = await createNote()
      setFresh(note)
      setQuery('')
      navigate(`/n/${note.id}`)
    } catch (err) {
      setNotice((err as Error).message)
    }
  }

  return (
    <div className="desk" data-view={noteId || surveyId || writingSurvey ? 'note' : 'index'}>
      <NoteIndex
        notes={filtered}
        surveys={filteredSurveys}
        total={notes.length + live.surveys.length}
        loaded={live.loaded}
        presence={live.presence}
        activeId={noteId}
        activeSurveyId={surveyId}
        query={query}
        onQuery={setQuery}
        onNew={newNote}
        onNewSurvey={() => navigate(NEW_SURVEY)}
        user={user}
        onEditUser={() => setEditingUser(true)}
        connected={live.connected}
      />
      <main className="desk__page">
        {noteId && user ? (
          <NotePage key={noteId} id={noteId} meta={current} user={user} onGone={setNotice} />
        ) : surveyId && user ? (
          <SurveyPage key={surveyId} id={surveyId} meta={currentSurvey} user={user} onGone={setNotice} />
        ) : writingSurvey && user ? (
          <NewSurvey key={location.search} />
        ) : (
          <section className="sheet sheet--blank" aria-label="No page open">
            <div className="blank">
              <p className="blank__hand">
                Pick a page from the index,
                <br />
                or start a fresh one.
              </p>
              <button className="stamp-btn" onClick={newNote}>
                + New page
              </button>
              {notice && <p className="blank__notice">{notice}</p>}
            </div>
          </section>
        )}
      </main>
      {(!user || editingUser) && (
        <WhoCard
          initial={user}
          onSave={(u) => {
            saveUser(u)
            setUser(u)
            setEditingUser(false)
          }}
          onCancel={user ? () => setEditingUser(false) : undefined}
        />
      )}
    </div>
  )
}

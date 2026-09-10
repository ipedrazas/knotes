import { useEffect, useMemo, useRef, useState } from 'react'
import { createNote, navigate, noteIdFrom, useLiveIndex, usePath, type NoteMeta } from './api.ts'
import { loadUser, saveUser, type User } from './user.ts'
import { NoteIndex } from './components/NoteIndex.tsx'
import { NotePage } from './components/NotePage.tsx'
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

  const notes = useMemo(
    () => (fresh && !live.notes.some((n) => n.id === fresh.id) ? [fresh, ...live.notes] : live.notes),
    [fresh, live.notes],
  )
  const current = notes.find((n) => n.id === noteId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? notes.filter((n) => `${n.title}\n${n.preview}`.toLowerCase().includes(q)) : notes
  }, [notes, query])

  useEffect(() => {
    if (path !== '/' && !noteId) navigate('/', true)
  }, [path, noteId])

  // Someone else tore out the page we're on: go back to the index.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    if (!live.loaded) return
    for (const n of live.notes) seen.current.add(n.id)
    if (noteId && seen.current.has(noteId) && !live.notes.some((n) => n.id === noteId)) {
      setNotice('That page was torn out of the notebook.')
      navigate('/', true)
    }
  }, [live.loaded, live.notes, noteId])

  useEffect(() => {
    document.title = current ? `${current.title || 'Untitled'} · knotes` : 'knotes'
  }, [current])

  useEffect(() => {
    if (noteId) setNotice(null)
  }, [noteId])

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
    <div className="desk" data-view={noteId ? 'note' : 'index'}>
      <NoteIndex
        notes={filtered}
        total={notes.length}
        loaded={live.loaded}
        presence={live.presence}
        activeId={noteId}
        query={query}
        onQuery={setQuery}
        onNew={newNote}
        user={user}
        onEditUser={() => setEditingUser(true)}
        connected={live.connected}
      />
      <main className="desk__page">
        {noteId && user ? (
          <NotePage key={noteId} id={noteId} meta={current} user={user} onGone={setNotice} />
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

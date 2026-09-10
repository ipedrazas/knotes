import { useEffect, useState, useSyncExternalStore } from 'react'

export interface NoteMeta {
  id: string
  title: string
  preview: string
  updatedAt: number
}

export interface Writer {
  name: string
  color: string
  typing: boolean
}

export interface LiveIndex {
  notes: NoteMeta[]
  presence: Record<string, Writer[]>
  connected: boolean
  loaded: boolean
}

// The note list and who is in which note, pushed by the server over SSE.
export function useLiveIndex(): LiveIndex {
  const [state, setState] = useState<LiveIndex>({ notes: [], presence: {}, connected: false, loaded: false })

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = (e) => {
      const { notes, presence } = JSON.parse(e.data)
      setState({ notes, presence, connected: true, loaded: true })
    }
    events.onerror = () => setState((s) => ({ ...s, connected: false }))
    return () => events.close()
  }, [])

  return state
}

export async function createNote(): Promise<NoteMeta> {
  const res = await fetch('/api/notes', { method: 'POST' })
  if (!res.ok) throw new Error(`Could not create a note (${res.status})`)
  return res.json()
}

export async function deleteNote(id: string) {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Could not delete the note (${res.status})`)
}

export const collabUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

// ── Routing: two routes, / and /n/:id, so no router library ─────────────────
const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname)

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export const noteIdFrom = (path: string) => /^\/n\/([a-z0-9]{10})\/?$/.exec(path)?.[1] ?? null

// ── Dates ────────────────────────────────────────────────────────────────────
const DAY = 86_400_000

export function shortDate(ms: number) {
  const date = new Date(ms)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (ms >= today.getTime()) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (ms >= today.getTime() - DAY) return 'Yesterday'
  if (ms >= today.getTime() - 6 * DAY) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

export function longDate(ms: number) {
  const date = new Date(ms)
  const day = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

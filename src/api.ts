import { useEffect, useState, useSyncExternalStore } from 'react'
import { NOTE_ID } from '../shared/address.ts'

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
  // Old addresses of renamed notes → where the note is now.
  moved: Record<string, string>
  connected: boolean
  loaded: boolean
}

// The note list, who is in which note and where renamed notes went, pushed by the server over SSE.
export function useLiveIndex(): LiveIndex {
  const [state, setState] = useState<LiveIndex>({ notes: [], presence: {}, moved: {}, connected: false, loaded: false })

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = (e) => {
      const { notes, presence, moved } = JSON.parse(e.data)
      setState({ notes, presence, moved: moved ?? {}, connected: true, loaded: true })
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

export async function renameNote(id: string, to: string): Promise<NoteMeta> {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: to }),
  })
  if (res.ok) return res.json()
  const { error } = await res.json().catch(() => ({}))
  throw new Error(error ?? `Could not change the address (${res.status})`)
}

export const collabUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

export const noteUrl = (id: string) => `${location.origin}/n/${id}`

// A QR code for a link, as an SVG drawn by qr.andcake.dev from the link alone, in ink on card.
export const qrCodeUrl = (url: string) =>
  `https://qr.andcake.dev/qr?${new URLSearchParams({ url, fg: '#1d2a44', bg: '#fffdf7' })}`

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

// Addresses get typed from memory, so /n/My-Party finds my-party.
export function noteIdFrom(path: string) {
  const id = /^\/n\/([^/]+)\/?$/.exec(path)?.[1].toLowerCase()
  return id && NOTE_ID.test(id) ? id : null
}

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

import { useEffect, useState, useSyncExternalStore } from 'react'
import { NOTE_ID } from '../shared/address.ts'
import type { SurveyDraft, SurveyMeta, SurveyView } from '../shared/survey.ts'
import type { User } from './user.ts'

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
  surveys: SurveyMeta[]
  connected: boolean
  loaded: boolean
}

// The note list, who is in which note, where renamed notes went and the surveys, pushed
// by the server over SSE.
export function useLiveIndex(): LiveIndex {
  const [state, setState] = useState<LiveIndex>({
    notes: [],
    presence: {},
    moved: {},
    surveys: [],
    connected: false,
    loaded: false,
  })

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = (e) => {
      const { notes, presence, moved, surveys } = JSON.parse(e.data)
      setState({ notes, presence, moved: moved ?? {}, surveys: surveys ?? [], connected: true, loaded: true })
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

// ── Surveys ──────────────────────────────────────────────────────────────────
// No accounts: this browser's voter token is who votes, and the owner tokens it was
// given when publishing are what let it close or delete those surveys.
const VOTER = 'knotes:voter'
const OWNS = 'knotes:surveys'
let voterInMemory = ''

function voterToken() {
  try {
    let token = localStorage.getItem(VOTER)
    if (!token) localStorage.setItem(VOTER, (token = randomToken()))
    return token
  } catch {
    // private mode: one vote per visit
    return (voterInMemory ||= randomToken())
  }
}

const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('')

function ownerTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWNS) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export function saveOwnerToken(id: string, token: string) {
  try {
    localStorage.setItem(OWNS, JSON.stringify({ ...ownerTokens(), [id]: token }))
  } catch {
    // private mode: keep the owner link
  }
}

// Someone opened their owner link (/s/<id>#owner=<token>): keep the token, tidy the address.
export function adoptOwnerLink(id: string) {
  const token = new URLSearchParams(location.hash.slice(1)).get('owner')
  if (!token) return
  saveOwnerToken(id, token)
  history.replaceState(null, '', location.pathname + location.search)
}

const surveyHeaders = (id: string): Record<string, string> => {
  const owner = ownerTokens()[id]
  return { 'X-Voter': voterToken(), ...(owner ? { 'X-Owner': owner } : {}) }
}

async function failure(res: Response, what: string) {
  const { error } = await res.json().catch(() => ({}))
  return new Error(error ?? `Could not ${what} (${res.status})`)
}

export async function fetchSurvey(id: string): Promise<SurveyView | null> {
  const res = await fetch(`/api/surveys/${id}`, { headers: surveyHeaders(id) })
  if (res.status === 404) return null
  if (!res.ok) throw await failure(res, 'open the survey')
  return res.json()
}

export async function publishSurvey(draft: SurveyDraft, address: string): Promise<SurveyView> {
  const res = await fetch('/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draft, id: address || undefined }),
  })
  if (!res.ok) throw await failure(res, 'publish the survey')
  const { survey, ownerToken } = await res.json()
  saveOwnerToken(survey.id, ownerToken)
  return survey
}

export async function vote(id: string, choices: number[], user: User): Promise<SurveyView> {
  const res = await fetch(`/api/surveys/${id}/vote`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...surveyHeaders(id) },
    body: JSON.stringify({ choices, name: user.name, color: user.color }),
  })
  if (!res.ok) throw await failure(res, 'vote')
  return res.json()
}

export async function closeSurvey(id: string): Promise<SurveyView> {
  const res = await fetch(`/api/surveys/${id}/close`, { method: 'POST', headers: surveyHeaders(id) })
  if (!res.ok) throw await failure(res, 'close the survey')
  return res.json()
}

export async function deleteSurvey(id: string) {
  const res = await fetch(`/api/surveys/${id}`, { method: 'DELETE', headers: surveyHeaders(id) })
  if (!res.ok && res.status !== 404) throw await failure(res, 'delete the survey')
}

export const surveyUrl = (id: string) => `${location.origin}/s/${id}`

// The link that makes another browser this survey's owner too.
export const ownerUrl = (id: string) => {
  const token = ownerTokens()[id]
  return token ? `${surveyUrl(id)}#owner=${token}` : null
}

export const collabUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

export const noteUrl = (id: string) => `${location.origin}/n/${id}`

// A QR code for a link, as an SVG drawn by qr.andcake.dev from the link alone, in ink on card.
export const qrCodeUrl = (url: string) =>
  `https://qr.andcake.dev/qr?${new URLSearchParams({ url, fg: '#1d2a44', bg: '#fffdf7' })}`

// ── Routing: a handful of routes (/, /n/:id, /s/new, /s/:id), so no router library ──
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

// /s/new is where surveys get written; /s/new?from=<id> starts from a copy of one.
export const NEW_SURVEY = '/s/new'

export function surveyIdFrom(path: string) {
  const id = /^\/s\/([^/]+)\/?$/.exec(path)?.[1].toLowerCase()
  return id && id !== 'new' && NOTE_ID.test(id) ? id : null
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

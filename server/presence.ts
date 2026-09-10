// Who has each note open, and who is typing in it right now, derived from the Yjs
// awareness states clients broadcast. The index uses this to show writers next to notes.
import { EventEmitter } from 'node:events'
import type { Document } from '@hocuspocus/server'

type Awareness = Document['awareness']

export interface Writer {
  name: string
  color: string
  typing: boolean
}

// How long after their last keystroke someone still counts as "writing".
const TYPING_MS = 3000

const COLOR = /^#[0-9a-f]{6}$/i

interface Seen {
  typingAt: unknown
  since: number
}

export class Presence extends EventEmitter {
  private notes = new Map<string, Writer[]>()
  private seen = new Map<string, Map<number, Seen>>()
  private timers = new Map<string, NodeJS.Timeout>()

  update(noteId: string, awareness: Awareness) {
    const seen = this.seen.get(noteId) ?? new Map<number, Seen>()
    const now = Date.now()
    const writers: Writer[] = []
    const next = new Map<number, Seen>()

    for (const [clientId, state] of awareness.getStates()) {
      const user = state?.user
      if (!user || typeof user.name !== 'string') continue
      // Clients stamp `typingAt` on every local edit. Compare it with what we saw last
      // rather than with our clock, so clock skew between devices doesn't matter. The
      // first time we see a client doesn't count: its stamp may be from long ago.
      const prev = seen.get(clientId)
      const since = !prev ? 0 : prev.typingAt === state.typingAt ? prev.since : now
      next.set(clientId, { typingAt: state.typingAt, since })
      writers.push({
        name: user.name.slice(0, 40),
        color: COLOR.test(user.color) ? user.color : '#1d2a44',
        typing: now - since < TYPING_MS,
      })
    }

    this.seen.set(noteId, next)
    this.set(noteId, writers)

    // Re-check once the typing window lapses so "writing…" goes away on its own.
    clearTimeout(this.timers.get(noteId))
    if (writers.some((w) => w.typing)) {
      this.timers.set(noteId, setTimeout(() => this.update(noteId, awareness), TYPING_MS + 50))
    }
  }

  clear(noteId: string) {
    clearTimeout(this.timers.get(noteId))
    this.timers.delete(noteId)
    this.seen.delete(noteId)
    this.set(noteId, [])
  }

  snapshot(): Record<string, Writer[]> {
    return Object.fromEntries(this.notes)
  }

  private set(noteId: string, writers: Writer[]) {
    const before = JSON.stringify(this.notes.get(noteId) ?? [])
    if (writers.length) this.notes.set(noteId, writers)
    else this.notes.delete(noteId)
    if (before !== JSON.stringify(writers)) this.emit('change')
  }
}

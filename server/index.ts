// knotes server: the REST API and live index (SSE) on Express, and Yjs sync through
// Hocuspocus on the same port at /collab. Serves the built client in production.
import http from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import { NOTE_ID } from '../shared/extensions.ts'
import { NoteStore } from './store.ts'
import { Presence } from './presence.ts'

const PORT = Number(process.env.PORT ?? 3000)
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data')
const STATIC_DIR = path.resolve(import.meta.dirname, '../dist/client')

const store = new NoteStore(DATA_DIR)
try {
  await store.init()
} catch (err) {
  console.error(`[knotes] cannot use DATA_DIR ${DATA_DIR}: ${(err as Error).message}`)
  console.error('[knotes] the directory must exist and be writable by the container user (uid 1000 by default)')
  process.exit(1)
}
const presence = new Presence()

const hocuspocus = new Hocuspocus({
  quiet: true,
  // Write to disk 2s after typing stops, and at least every 10s while it doesn't.
  debounce: 2000,
  maxDebounce: 10000,
  async onConnect({ documentName }) {
    if (!store.has(documentName)) throw new Error('No such note')
  },
  async onLoadDocument({ document, documentName }) {
    await store.load(documentName, document)
  },
  async onStoreDocument({ document, documentName }) {
    await store.save(documentName, document)
  },
  async onAwarenessUpdate({ documentName, awareness }) {
    presence.update(documentName, awareness)
  },
  async afterUnloadDocument({ documentName }) {
    presence.clear(documentName)
  },
})

// ── HTTP ─────────────────────────────────────────────────────────────────────
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/notes', (_req, res) => {
  res.json(store.list())
})

app.post('/api/notes', async (_req, res) => {
  res.status(201).json(await store.create())
})

app.get('/api/notes/:id/markdown', (req, res) => {
  const file = NOTE_ID.test(req.params.id) ? store.fileOf(req.params.id) : undefined
  if (!file) return void res.sendStatus(404)
  res.type('text/markdown; charset=utf-8')
  res.attachment(path.basename(file).replace(/--[a-z0-9]{10}\.md$/, '.md'))
  res.sendFile(file)
})

app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params
  if (!NOTE_ID.test(id) || !(await store.remove(id))) return void res.sendStatus(404)
  hocuspocus.closeConnections(id)
  presence.clear(id)
  res.sendStatus(204)
})

// The index, live: every open tab gets the note list and who is in which note,
// again whenever either changes.
const listeners = new Set<express.Response>()
let pending: NodeJS.Timeout | undefined
const broadcast = () => {
  pending ??= setTimeout(() => {
    pending = undefined
    const data = `data: ${JSON.stringify(snapshot())}\n\n`
    for (const res of listeners) res.write(data)
  }, 150)
}
const snapshot = () => ({ notes: store.list(), presence: presence.snapshot() })
store.on('change', broadcast)
presence.on('change', broadcast)

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx (and so Nginx Proxy Manager) buffers responses unless told not to.
    'X-Accel-Buffering': 'no',
  })
  res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot())}\n\n`)
  listeners.add(res)
  // Keep idle proxies from closing the stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => {
    clearInterval(ping)
    listeners.delete(res)
  })
})

app.use('/api', (_req, res) => {
  res.sendStatus(404)
})

if (existsSync(STATIC_DIR)) {
  app.use('/assets', express.static(path.join(STATIC_DIR, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(STATIC_DIR, { index: false }))
  // Client-side routes (/, /n/:id) all get the app shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(STATIC_DIR, 'index.html'))
  })
}

// ── WebSocket ────────────────────────────────────────────────────────────────
const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/collab') return void socket.destroy()

  wss.handleUpgrade(req, socket, head, (ws) => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value)
    }
    const client = hocuspocus.handleConnection(ws, new Request(url, { headers }))
    ws.on('message', (data: Buffer) => client.handleMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)))
    ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() }))
    ws.on('error', (err) => console.error('[collab] socket error:', err.message))
  })
})

server.listen(PORT, () => {
  console.log(`[knotes] listening on :${PORT}, notes in ${DATA_DIR}`)
})

// ── Shutdown ─────────────────────────────────────────────────────────────────
// Save every open note straight away rather than waiting for the debounce, so a
// redeploy never loses the last few seconds of typing.
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`[knotes] ${signal}: saving open notes`)
  server.close()
  for (const res of listeners) res.end()
  await Promise.allSettled(
    [...hocuspocus.documents].filter(([name]) => store.has(name)).map(([name, doc]) => store.save(name, doc)),
  )
  await store.idle()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

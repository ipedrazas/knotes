# knotes

A shared notebook. Several people write in the same note at once, like Apple Notes
with friends: you see everyone's cursor with their name on it, and who's writing right
now. Notes are plain markdown files on disk.

Runs at <https://knotes.andcake.dev>.

## What's in it

- **Real-time editing.** Yjs CRDTs synced through [Hocuspocus](https://tiptap.dev/docs/hocuspocus),
  so concurrent edits merge instead of overwriting each other.
- **Presence.** Coloured, named cursors in the note. "Ana is writing…" at the top of the page,
  and in the index, ink blots and a pen next to whichever note someone is writing in.
- **Rich text, stored as markdown.** A [TipTap](https://tiptap.dev) editor with titles,
  headings, bold/italic/strike, code, links, bulleted, numbered and check lists, quotes, code
  blocks and dividers. Markdown shortcuts work as you type (`# `, `- `, `[ ] `, `> `, ```` ``` ````).
- **No accounts.** On your first visit you pick a name and an ink colour. They're kept in your
  browser. Anyone who can reach the site can read, write and delete, so if it's exposed to the
  internet, put an access list on the proxy host in Nginx Proxy Manager.

## Notes on disk

```
/data
├── weekend-in-folkestone--k3j9x0a2bc.md   ← the note, named after its first line
├── shopping--p0q8z7m1ns.md
├── .knotes/                               ← Yjs state per note (see below)
└── .trash/                                ← deleted notes end up here
```

- The first line of a note is its title, and the file is renamed when the title changes. The
  part after `--` is the note's id, which is also its address: `/n/k3j9x0a2bc`.
- **Addresses can be changed.** "Address" on a note gives it a memorable one, like
  `/n/my-party` (lowercase letters, numbers and dashes). The id and the files change with
  it, and the old address keeps redirecting: `.knotes/moved.json` remembers where notes
  went. If someone has the note open while it moves, they follow it to the new address, and
  whatever they typed during the move is kept.
- Notes are written 2 seconds after typing stops, and at least every 10 seconds while someone
  keeps typing. On shutdown (SIGTERM) every open note is saved straight away.
- Next to each note, `.knotes/<id>.yjs` holds its Yjs state. Without it, rebuilding a note from
  markdown after a restart would duplicate text for anyone reconnecting with the old version.
  Deleting `.knotes/` is safe: notes are rebuilt from the markdown.
- **You can edit the files by hand.** If a `.md` no longer matches the markdown saved with its
  Yjs state, the markdown wins the next time the note is opened. It's best to do this while
  nobody has the note open.
- **You can drop `.md` files into the folder.** On the next start they're picked up and renamed
  to `title--id.md`.
- The markdown written is CommonMark plus `~~strike~~` and `- [ ]` task lists. Images and raw
  HTML are kept as text. Empty lines between paragraphs aren't kept in the markdown, only in
  the Yjs state.

## Development

Needs Node 24+.

```sh
npm install
npm run dev          # server on :3000 (notes in ./data) + Vite on :5173, proxied
npm test             # markdown round-trips and the note store
npm run typecheck
npm run build        # client into dist/client
npm start            # production server, serving dist/client
```

| Variable   | Default  | What                                    |
| ---------- | -------- | --------------------------------------- |
| `PORT`     | `3000`   | HTTP and websocket port                 |
| `DATA_DIR` | `./data` | Where notes live (`/data` in the image) |

Layout: `server/` is Express (REST, plus a live index over SSE at `/api/events`) and Hocuspocus
(websocket at `/collab`) on one port. `src/` is the React client. `shared/extensions.ts` is the
document schema, used by both. Node runs the server's TypeScript directly, with no compile step.

## Deploying

Pushing to `main` runs CI and publishes `ghcr.io/ipedrazas/knotes:latest`, built for amd64 and
arm64. A `v1.2.3` tag also publishes `1.2.3` and `1.2`.

On the VM:

```sh
mkdir -p notes && sudo chown 1000:1000 notes     # the container runs as uid 1000
docker compose pull && docker compose up -d
```

In Nginx Proxy Manager, the proxy host for `knotes.andcake.dev` points at the VM on port 3000,
with **Websockets Support switched on**. Without it pages load, but notes never sync.

To have GitHub Actions redeploy after publishing, set the repository variable
`DEPLOY_ENABLED=true` (and optionally `DEPLOY_PATH`, which defaults to `/srv/knotes`), then add
the `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_SSH_KEY` secrets.

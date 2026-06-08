# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An in-person fantasy football **draft day** app: a big-screen TV board with dramatic pick reveals, plus phone-based control for the commissioner and players. Real-time over Socket.IO; no accounts, no external data (built-in 50-player fake dataset).

## Commands

```bash
npm run dev          # Vite client (5173) + server (4000), hot reload — develop here
npm run build        # builds client then server (server serves client/dist in prod)
npm start            # production: serves everything on http://localhost:4000
npm run typecheck    # tsc --noEmit across both workspaces

npm test             # server unit tests (Vitest): draft logic, store, auth
npm run test:e2e     # full draft over real Socket.IO against a server subprocess
npm run test:browser # headless Chromium drives the real UI + checks the reveal
npm run screenshots  # regenerate screenshots/

npm run yahoo:auth   # one-time: authorize the Yahoo app, saves refresh token to .env
npm run yahoo:sync   # fetch real NFL player pool from Yahoo -> server/data/players-yahoo.json
```

- **The server runs on port 4000, not 3000.** In dev, open `http://localhost:5173` (Vite proxies `/api` and `/socket.io` to 4000).
- Run a single server test: `npm test -w server -- draft.test.ts` (or `-t "<name>"` to filter by test name).
- Browser tests require Chromium: `npx playwright install chromium`.
- **Yahoo data is optional and server-side only.** `server/src/yahoo/` holds OAuth + a player-pool fetcher driven by the two CLIs above; runtime/tests never hit the network. `players.ts` serves `server/data/players-yahoo.json` if present, else the built-in 50-player dataset. Credentials live in `.env` (gitignored): `YAHOO_CLIENT_ID/SECRET/REDIRECT_URI` set by hand, `YAHOO_REFRESH_TOKEN` written by `yahoo:auth`.

## Architecture

npm workspaces monorepo: `server/`, `client/`, and `shared/` (types only).

- **`shared/types.d.ts`** is the single source of truth for all domain types **and** the Socket.IO event contracts (`ClientToServerEvents` / `ServerToClientEvents`). Both packages import it (client via the `@shared` Vite alias). Change an event payload here and both ends are type-checked against it.

- **Server is authoritative.** All draft state and validation lives server-side; the client never decides whose turn it is or whether a pick is legal.
  - `server/src/draft.ts` — pure, I/O-free draft math (snake/linear ordering, slot resolution). The snake rule: odd rounds use `draftOrder`, even rounds reverse it. This is where unit tests concentrate.
  - `server/src/store.ts` — `SessionStore`, the in-memory session map with **debounced disk persistence** to `server/data/sessions.json` (restart-resilient). Holds the only copy of secret tokens. All mutations go through methods that throw on invalid input; setup-only mutations call `assertSetup` (config/teams/order lock once the draft starts).
  - `server/src/socket.ts` — thin event handlers that authorize, mutate via `store`, then broadcast. The `withAdmin` helper wraps admin-only events.
  - `server/src/index.ts` — Express + Socket.IO bootstrap; serves `client/dist` with an SPA fallback in production.
  - `server/src/players.ts` — the static 50-player dataset.

- **Client** (React + Vite + react-router). Four routes, each a page in `client/src/pages/`: `/` (Home), `/admin/:code` (commissioner), `/board/:code` (TV), `/play/:code` (player). State comes from the `useSessionState`/`useReveal`/`useCountdown` hooks in `client/src/lib/useDraft.ts`, which subscribe to the shared socket. Sounds are generated procedurally via Web Audio (`client/src/lib/sound.ts`) — no audio assets.

## Key model details (non-obvious)

- **Security is capability-token based, no accounts.** A session has one `adminToken` (commissioner) and a per-team `token`. Tokens are crypto-random `nanoid`s, stored only on the server and in each client's `localStorage`. `toPublicState` strips all tokens before broadcasting — they never reach the board or other players. Authorization for a pick goes through `store.authorizeActor`: the admin token can always pick (and is the only picker in commissioner mode); in self-pick mode a team token may only pick when that team is on the clock.

- **Two-phase pick flow.** On `pick:make`, the server first emits `state:update` (authoritative snapshot, keeps everyone consistent) and *then* emits a separate `pick:reveal` event carrying the player/team/flags. The board deliberately animates the reveal (ding → "THE PICK IS IN" → card) off the `pick:reveal` event rather than popping the pick straight onto the grid from the state update.

- **Join codes** are 5 chars from an unambiguous alphabet (no 0/O/1/I) — `store.get` upper-cases input so codes are case-insensitive.

- **Derived state is computed, not stored:** `currentOverall`, `onClockTeamId`, and `pickDeadline` are all recomputed in `toPublicState` from the pick list + config; only the raw `picks` array and `draftOrder` are persisted.

## Conventions

- ESM throughout (`"type": "module"`). Server imports use `.js` extensions on relative paths (including into `../../shared/types.js`) even though sources are `.ts` — required for Node ESM resolution after `tsc`. Keep this when adding imports.
- TypeScript `strict` is on in both workspaces.
- Never downgrade dependencies or tooling without explicit permission.

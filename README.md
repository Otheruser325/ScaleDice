# ScaleDice

Incremental turn-based dice game with a twist.

## Play locally

Open `client/index.html` through any static file server, or run the bundled
server (which also hosts online play):

```bash
npm install
npm start
```

Then open http://localhost:8080.

## Online play (v1.3.0)

Online mode uses the bundled Node server for accounts, lobbies and
server-authoritative matches.

- **Accounts:** create a guest account (username + password) or sign in with
  Google/Discord when the server has OAuth credentials configured.
- **Lobbies:** a signed-in host creates a 2–6 player lobby with 10–100 rounds,
  optional blue/red teams, optional big upgrades, and the local upgrade-cost
  multiplier. Online matches always use Scale Dice's local progression rules:
  one starting die, dice unlocks, luck, economy, combos, and big upgrades. The
  host assigns teams before launch; each side needs at least one player and the
  sides may differ by at most one. Share the 6-character code; players ready up
  and the host starts the match.
- **Turns:** choose a 15–60 second turn timer. If a player does not roll, the
  server rolls for them and passes the turn. The server owns all dice, scores,
  rounds, team totals and timeouts. Leaving or disconnecting mid-match forfeits.

The browser client can be hosted separately from the API. Point it at the
server with `?server=https://api.example.com` and allow its origin with
`CLIENT_ORIGINS`.

### Online storage

Online storage is selected at startup:

- **Supabase** when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
  Run [server/supabase/schema.sql](server/supabase/schema.sql) once in the
  Supabase SQL editor. The service-role key is server-only and must never be
  exposed to the browser.
- **In-memory** otherwise. Accounts and lobby snapshots are process-local and
  are discarded when the server restarts. This is the zero-config local mode.

`STORAGE_MODE=memory` forces local mode even when Supabase credentials exist;
`STORAGE_MODE=supabase` requires complete credentials. Live turn state stays in
server memory in both modes; Supabase persists account rows and lobby snapshots
for restart recovery.

### Production sessions

Local development uses in-memory sessions. A production server requires
`SESSION_SECRET` and a Redis session store via `REDIS_URL`; startup fails closed
if Redis is unavailable. `ALLOW_MEMORY_SESSIONS=1` is only for a single instance
that explicitly accepts process-local sessions. Authenticated sockets reload
their session before every packet, so logout and expiry revoke open connections,
not just new handshakes. Connections are also capped per IP and in total.

## Development

```bash
npm run dev           # server + client watch mode
npm test              # server, auth, scoring and socket regression tests
npm run test:browser  # Playwright team smoke test (install Chromium first)
```

See [server/AGENTS.md](server/AGENTS.md) for the server architecture, online
event contract, invariants and deployment configuration.

## Version

v1.3.0 — online play and account login.

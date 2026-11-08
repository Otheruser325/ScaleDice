# Scale Dice — online server guide

This directory implements online play for v1.3.0. It keeps Scale Dice's local
progression contract: an account session authenticates the Socket.IO connection,
a host creates a lobby, players join by code and ready up, and the server owns
every die, score, upgrade, turn and timeout. Online matches use the same
progression rules as LocalGameScene; there is no classic/Fives fallback.

## Commands

```bash
npm install          # install runtime + test dependencies
npm start            # serve the game and the API on http://localhost:8080
npm run dev          # nodemon with server/client watching
npm test             # node --test test/*.test.js
```

The browser client is served from `client/` by the same process. A separately
hosted client can point at the API with `?server=https://api.example.com` or
`window.__SCALEDICE_SERVER__`.

## Layout

| File | Responsibility |
| --- | --- |
| `index.js` | Binds the HTTP port, graceful shutdown. The only file that listens. |
| `app.js` | Express/HTTP/Socket.IO wiring, Redis or memory sessions, per-packet session reload, socket connection caps, security/CORS headers, static client, health. |
| `auth.js` | Passport session, same-origin guard, serialized guest registration, guest login, optional Google & Discord OAuth. |
| `lobbyManager.js` | Lobbies, membership, ready checks, turns, scoring, timeouts, cleanup, persisted lobby restore. |
| `utils/dice.js` | CSPRNG rolls and base-score helpers. |
| `utils/combo.js` | Server copy of the client combo table; parity is tested. |
| `utils/gameConfig.js` | Shared online lobby config normalization. |
| `utils/storageMode.js` | Selects Supabase vs process-memory online storage. |
| `utils/userStorage.js` | Supabase or process-memory accounts and public-user projection. |
| `utils/lobbyStorage.js` | Supabase or in-memory lobby snapshots. |
| `utils/passwords.js` | scrypt guest-password hashing and constant-work failures. |
| `utils/origins.js` | Shared CORS / same-origin / OAuth redirect origin policy. |
| `supabase/schema.sql` | Required `users` and `lobbies` tables, indexes and RLS state. |

Tests live in `test/`. `test/lobby.test.js` drives the engine through fake
sockets, `test/auth.test.js` covers the HTTP session API, `test/scoring.test.js`
checks combo scoring and six-dice high-tier combinations against the client table,
`test/storage.test.js` covers Supabase/memory accounts and lobby persistence, and
`test/online-e2e.test.js` verifies that a real Socket.IO connection inherits the
HTTP session identity, rejects forged identities, and is disconnected when the
HTTP session logs out. `test/auth.test.js` also covers missing/foreign Origin
rejection for unsafe auth requests.

## Authentication invariants

- **A socket's identity is its HTTP session.** `socket.request.user` is the only
  source of `socket.data.user`. The client-dispatched `auth-user` event can only
  confirm that identity; a missing session or mismatched id is rejected with
  `auth-failed` and never establishes a player.
- The session is reloaded from the backing store before every authenticated
  Socket.IO packet. Checks are serialized per socket, bounded by
  `SESSION_RELOAD_TIMEOUT_MS`, and a socket is disconnected if the session is
  missing, expired, or belongs to a different user. This makes logout, expiry and
  revocation effective for already-open connections, not just new handshakes.
- Unsafe auth HTTP methods require a same-origin `Origin` (or `Referer`). A
  missing or foreign origin is rejected with 403; relying on `SameSite=None`
  cookies alone is not enough. Guest name allocation and save are serialized in
  one process, and rate-limit buckets are periodically swept.
- Guest passwords are stored as `scrypt$salt$hash` and compared with
  `timingSafeEqual`. Unknown usernames still run a password verification so
  login timing does not reveal account existence.
- `publicUser()` is the only shape sent to clients. Password hashes and provider
  ids/tokens never leave the server.
- OAuth providers are optional. They are enabled only when both
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or
  `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` are set. `/auth/providers` drives
  which buttons the client shows. OAuth uses a one-time state value bound to the
  browser session, and returns to the client root with `?auth=success|error`.
- Logout destroys the session and disconnects sockets that belong to it, which
  forfeits any match they were in.
- Online storage is selected once at startup. Supabase is active only when both
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present; otherwise accounts
  and lobby snapshots live in process memory. User writes fail closed when
  Supabase is active, and lobby creation fails with `storage_unavailable` rather
  than silently creating a memory-only room.

## Online game semantics

Event flow:

1. `create-lobby` → `lobby-created` → `lobby-updated`.
2. `join-lobby` → `join-success` → broadcast `lobby-updated`.
3. `toggle-ready` → broadcast `lobby-updated`.
4. Host `set-player-team` → `lobby-updated`; changing a team resets that
   player's ready flag. Non-hosts receive `team-change-failed`.
5. Host `start-game` → `game-starting` + personalized `game-state` + `turn-start`.
6. Current player `player-roll` → `player-rolling` → `turn-result` (dice, scored,
   combo, scores, comboStats, team fields, `turnExpiresAt`).
7. Current player `player-end-turn` → next `turn-start`, or `game-finished` after
   the final round.
8. Current player `buy-upgrade` → server-priced `upgrade-result`; the client
   never supplies a cost.
9. `leave-lobby`/disconnect → `player-left`; if one player remains the game
   finishes.

Invariants enforced by `LobbyManager`:

- Every lobby/game action checks the authenticated session and membership.
- A lobby needs at least two active players, all ready, and the host to start.
- In team mode, teams are blue/red, each side needs at least one active player,
  and the sides may differ by at most one. Team totals and the winner are summed
  from server-owned player scores; ties have `winnerTeam: null`.
- Only the current player can roll or end their turn, and only once per turn.
- Dice come from `crypto.randomInt`; the server adds the score. The client's
  displayed score is never trusted.
- The server timer is the only timeout authority. It auto-rolls a sleeping
  player and passes the turn. Client `player-timeout` notifications are ignored.
- Rounds increment when the seat order wraps. The match ends when
  `round > totalRounds`.
- Disconnecting during a match is a forfeit: that player is marked `left` and
  cannot rejoin the running match. A host who leaves transfers host to the next
  active player.
- Lobby codes are 6 characters from a CSPRNG alphabet without look-alikes.
- Config is clamped: 2–6 players, 10–100 rounds, 5–300s turn timer, teams
  on/off, big upgrades on/off, and the local upgrade-cost multiplier. The client
  exposes the local 10/20/30/40/50/75/100 round ladder and a 15–60 second
  turn-timer shortcut. `progression` is always enabled; classic combo-only
  lobbies are not accepted.
- Live lobby and game state is authoritative in process memory. In Supabase mode,
  lobby snapshots are restored at startup; a restored lobby has no live sockets,
  readiness is reset, and stale/finished rows are deleted. Active turn/score
  state is intentionally not written on every roll. Running multiple instances
  still requires shared live state and sticky sessions.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `8080`). |
| `SESSION_SECRET` | Cookie signing secret. Required in production; development falls back to a random per-process secret. |
| `REDIS_URL` | Redis connection used for durable sessions. Required in production unless `ALLOW_MEMORY_SESSIONS=1`. |
| `ALLOW_MEMORY_SESSIONS` | Set to `1` only for a single production instance that explicitly accepts process-local sessions. |
| `REDIS_CONNECT_TIMEOUT_MS` / `REDIS_CONNECT_MAX_RETRIES` | Bounded Redis startup and reconnect behavior (defaults 1500ms / 1). |
| `SESSION_RELOAD_TIMEOUT_MS` | Per-packet session reload timeout (default 5000ms). |
| `SOCKET_MAX_PER_IP` / `SOCKET_CONNECT_LIMIT_PER_MINUTE` / `SOCKET_MAX_TOTAL` | Socket connection caps (defaults 60 / 120 / 2000). |
| `CLIENT_ORIGINS` / `CLIENT_URL` | Comma-separated allowed browser origins for a separately hosted client and the OAuth return URL. |
| `PUBLIC_SERVER_URL` | Public origin used to build OAuth callback URLs. |
| `TRUST_PROXY` | Set to `1` behind one HTTPS proxy so `secure: auto` cookies work. |
| `SUPABASE_URL` | Supabase project URL. Active only with the service-role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key. Never expose it to the client. |
| `STORAGE_MODE` | `auto` (default), `supabase`, or `memory`/`local`. Explicit Supabase mode requires credentials. |
| `SUPABASE_OPERATION_TIMEOUT_MS` | Bounded Supabase operation timeout, default `5000`. |
| `GOOGLE_*`, `DISCORD_*` | Optional OAuth credentials and callback URL overrides. |
| `AUTH_RATE_LIMIT_DISABLED=1` | Test-only escape hatch. Never use in production. |

Production notes: serve over HTTPS (production cookies are `SameSite=None`) and
set `SESSION_SECRET`. A production server refuses to start without `REDIS_URL`
unless `ALLOW_MEMORY_SESSIONS=1` is deliberately set; a Redis connection failure
is fail-closed, not a silent per-process fallback. Never run multiple instances
with memory sessions or without sticky Socket.IO routing. For durable accounts
and restartable lobbies, configure both Supabase variables and run
`server/supabase/schema.sql`; otherwise memory mode loses all accounts and
lobbies on restart. Never commit `.env` or provider secrets.

## Change hygiene

- Do not add comments for non-major changes. Keep diffs focused, and remove
  incidental comments unless they record a security boundary, protocol
  invariant, or non-obvious platform constraint.

## Adding online behaviour

- Keep all game-state mutations inside `LobbyManager`; scenes are views.
- Add the event to the server, the client handler, and at least one regression
  test that proves an unauthorized or out-of-turn caller cannot trigger it.
- Add lobby mutation persistence beside the mutation (see `_persistLobby`) so
  Supabase snapshots stay current; do not persist live score/turn state on every
  roll.
- If scoring or combo rules change, update **both** `client/utils/ComboManager.js`
  and `server/utils/combo.js`. `test/scoring.test.js` fails on any drift.
- Do not reintroduce localStorage or client-supplied ids as identity. The
  session is the authority.

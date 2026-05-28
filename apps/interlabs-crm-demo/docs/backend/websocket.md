---
audience: dev
reading_time: 7 min
last_reviewed: 2026-04-27
---

# Backend WebSocket layer

## Mental model

The WebSocket server is bound to the same HTTP listener as the Express app — `app.listen(port)` produces an `http.Server`, and `websocket.attach(server)` (`backend/src/app.js:84`) hooks an `'upgrade'` handler onto it that owns exactly one path: `/api/ws`. Same port, same TLS termination at Traefik, single process. The library is `ws` (`WebSocketServer` with `noServer: true`), so HTTP and WS routing both run under our control and a future second WS endpoint can slot in without rewriting the upgrade dispatcher (`backend/src/websocket/server.js:173`-`backend/src/websocket/server.js:213`).

Authentication runs **before** the upgrade completes. The handshake reads a JWT from `Authorization: Bearer <token>` first, then falls back to the `?token=<jwt>` query string (`backend/src/websocket/server.js:41`-`backend/src/websocket/server.js:54`) — browsers cannot set custom headers on the native `WebSocket` constructor, so the query-param path is mandatory for frontend parity. The token is verified with HS256 (`backend/src/websocket/server.js:62`), the subject is loaded from `users` and rejected if `deleted_at IS NOT NULL` or `account_status <> 'active'` (`backend/src/websocket/server.js:69`-`backend/src/websocket/server.js:79`), and any failure writes a plain HTTP `401` and destroys the socket without ever upgrading it (`backend/src/websocket/server.js:196`-`backend/src/websocket/server.js:206`). Successful upgrades emit a `ws:connected` hello frame so the client can reset its reconnect-backoff (`backend/src/websocket/server.js:151`-`backend/src/websocket/server.js:160`).

The connection registry lives in `backend/src/websocket/state.js` as **two in-process Maps** — `userConnections: Map<userId, Set<WebSocket>>` and `roleIndex: Map<roleKey, Set<userId>>` (`backend/src/websocket/state.js:23`-`backend/src/websocket/state.js:27`). One user may have multiple concurrent connections (tabs, devices); every send-to-user iterates the inner Set. There is **no Redis adapter and no cross-process WS state today** — see Invariants. Domain code (`NotificationService`, `POService`) imports `../websocket` and calls `sendToUser` / `sendToUsers` / `sendToRole` / `broadcastAll` (`backend/src/websocket/index.js:13`-`backend/src/websocket/index.js:22`). Reaching into `emitter.js` or `server.js` directly is prohibited so the internal split stays free to change.

Heartbeat is server-initiated: every 30 s the server flips `ws.isAlive=false`, pings, and the client's pong flips it back to true. A still-false flag at the next tick terminates the socket (`backend/src/websocket/server.js:92`-`backend/src/websocket/server.js:108`). Frames larger than ~32 KB (32 000 chars) are rejected with `ws:error` before parsing (`backend/src/websocket/server.js:125`-`backend/src/websocket/server.js:134`). Inbound frames are parsed and dispatched in `handlers.js` (`backend/src/websocket/server.js:122`-`backend/src/websocket/server.js:136`). Every outbound frame uses the envelope `{ event, data, ts }` (`backend/src/websocket/emitter.js:21`-`backend/src/websocket/emitter.js:27`). Realtime is **best-effort**: if the user has no open connection the message is silently dropped — REST list endpoints (notifications, chat history, **[PO](../business/system-overview.md#glossary-po)** tracking) remain authoritative on next page load.

## Wiring

### Connect handshake

```
client (browser / desktop)
  │
  │  GET /api/ws  Upgrade: websocket
  │  Authorization: Bearer <jwt>   OR   ?token=<jwt>
  ▼
Traefik  (TLS terminate, forward upgrade)
  │
  ▼
http.Server  (Express listener, backend/src/app.js:71)
  │  emits 'upgrade' event
  ▼
upgrade handler                                   server.js:176
  │
  ├─ pathname == '/api/ws' ? else return          server.js:187
  ├─ extractToken(req)                            server.js:41
  │     ├─ Authorization: Bearer ...              server.js:43
  │     └─ ?token=<jwt> query                     server.js:48
  ├─ jwt.verify(token, env.jwt.secret, HS256)     server.js:62
  ├─ SELECT users WHERE id = sub                  server.js:69
  │     └─ reject if deleted_at OR !active        server.js:77
  │
  ├─ ON FAIL → write HTTP 401 + destroy socket    server.js:196
  │
  └─ wss.handleUpgrade(req, socket, head, cb)     server.js:209
        │
        ▼
      onConnection(ws, userContext)               server.js:114
        ├─ ws.userContext = { userId, role, ... } server.js:115
        ├─ ws.isAlive = true                      server.js:116
        ├─ state.registerConnection(uid, role, ws) server.js:118
        │     └─ userConnections.get(uid).add(ws) state.js:29
        │     └─ roleIndex.get(role).add(uid)     state.js:38
        ├─ ws.on('message') → handleIncoming      server.js:122
        ├─ ws.on('close')   → unregisterConnection server.js:138
        └─ ws.send({ event: 'ws:connected' })     server.js:152
```

### Outbound emit (domain service → client)

```
domain service                                    e.g. notification.service.js:176
  │   ws.sendToUser(userId, 'notification:new', payload)
  ▼
websocket/index.js  (public facade)               index.js:16
  │   re-exports emitter.sendToUser
  ▼
emitter.sendToUser(userId, event, data)           emitter.js:44
  │
  ├─ state.getUserConnections(userId)             state.js:64
  │     └─ returns Set<WebSocket> | null
  │
  ├─ if (no conns) return 0  ── push silently dropped, REST is authoritative
  │
  ├─ frame = JSON.stringify({ event, data, ts })  emitter.js:21
  │
  └─ for ws of conns: safeSend(ws, frame)         emitter.js:50
        ├─ ws.readyState === OPEN ?               emitter.js:30
        ├─ ws.send(frame)                         emitter.js:32
        └─ try/catch — closed sockets drop silently
```

`sendToRole` follows the same path but resolves recipients through `state.getUsersForRole(role)` (`backend/src/websocket/emitter.js:76`, `backend/src/websocket/state.js:77`), so role pushes never hit the database — the `roleIndex` cache is populated at connect time. `broadcastAll` iterates `wss.clients` directly (`backend/src/websocket/emitter.js:95`-`backend/src/websocket/emitter.js:104`).

## Key files

| File | Purpose | Principal export |
|---|---|---|
| `backend/src/websocket/index.js` | Public facade for domain code | `attach`, `sendToUser`, `sendToUsers`, `sendToRole`, `broadcastAll`, `snapshot` (`backend/src/websocket/index.js:13`) |
| `backend/src/websocket/server.js` | HTTP-server attachment, JWT handshake, lifecycle, heartbeat | `attach(httpServer)` (`backend/src/websocket/server.js:167`) |
| `backend/src/websocket/state.js` | In-process connection + role-index registry | `registerConnection` (`backend/src/websocket/state.js:29`), `getUserConnections` (`backend/src/websocket/state.js:64`), `getUsersForRole` (`backend/src/websocket/state.js:77`) |
| `backend/src/websocket/emitter.js` | Fan-out helpers — only writer to client sockets | `sendToUser` (`backend/src/websocket/emitter.js:44`), `sendToRole` (`backend/src/websocket/emitter.js:76`), `broadcastAll` (`backend/src/websocket/emitter.js:95`) |
| `backend/src/websocket/handlers.js` | Client → server dispatch table + per-event handlers | `handleIncoming(socket, rawText)` (`backend/src/websocket/handlers.js:237`), `HANDLERS` (`backend/src/websocket/handlers.js:225`) |
| `backend/src/app.js` | Calls `websocket.attach(server)` after `app.listen` | `websocket.attach(server)` (`backend/src/app.js:84`) |

## Event catalogue

### Outbound (server → client)

Enumerated by reading every `ws.send(...)` and every `emitter.send*` call site across `backend/src/websocket/` and `backend/src/services/`.

| Event | Payload | Sent to | Emitter source |
|---|---|---|---|
| `ws:connected` | `{ user_id, role }` | the connecting socket only | `backend/src/websocket/server.js:152` |
| `ws:error` | `{ message }` | the offending socket only (frame > 32 KB) | `backend/src/websocket/server.js:127` |
| `<event>:error` | `{ message }` | the offending socket only (handler failure / unknown event / invalid JSON) | `backend/src/websocket/handlers.js:24` (via `replyError`) |
| `chat:joined` | `{ channel_id }` | the joining socket only | `backend/src/websocket/handlers.js:62` |
| `chat:message` | `{ channel_id, message_id, topic_id, sender_id, sender_name, content, created_at }` | every channel member (`sendToUser` per member) **plus** the sender's own tabs as echo | `backend/src/websocket/handlers.js:143`, `backend/src/websocket/handlers.js:148` |
| `chat:unread_update` | `{ channel_id, unread_count }` | every connection of the caller (multi-tab badge sync) | `backend/src/websocket/handlers.js:198` |
| `po:subscribe:ack` | `{ note }` | the subscribing socket only (placeholder — real updates flow through `po:status_update`) | `backend/src/websocket/handlers.js:215` |
| `po:status_update` | `{ po_id, po_number, new_status, updated_by_role, updated_at }` (payload semantics: see [po-state-machine.md](./po-state-machine.md#per-stage-detail)) | every connected user holding any role in the broadcast set (default recipients for the new status, **[Superadmin](../business/system-overview.md#glossary-superadmin)**, **[CEO](../business/system-overview.md#glossary-ceo)**) — `sendToRole` per role | `backend/src/services/po.service.js:340` |
| `notification:new` | `{ ...notification fields }` (per `NotificationService.emit` payload; see [notifications.md](./notifications.md)) | the recipient user (every connection) | `backend/src/services/notification.service.js:176` |
| `notification:count` | `{ unread_count }` (see [notifications.md](./notifications.md)) | the recipient user (every connection); fired after each `notification:new`, after `markRead`, and after `markAllRead` | `backend/src/services/notification.service.js:182`, `backend/src/services/notification.service.js:238` |

`broadcastAll` is exported but **no service calls it today**; it is reserved for future system-wide announcements.

### Inbound (client → server)

Dispatched through the frozen `HANDLERS` table at `backend/src/websocket/handlers.js:225`. Unknown event names reply `<event>:error` with `"unknown event"`.

| Type | Payload | Handler | Side effects |
|---|---|---|---|
| `chat:join_channel` | `{ channel_id }` | `onChatJoinChannel` (`backend/src/websocket/handlers.js:43`) | Verifies `chat_channel_members` row; stores `socket.userContext.lastChannelId`; replies `chat:joined` |
| `chat:send_message` | `{ channel_id, content, topic_id? }` | `onChatSendMessage` (`backend/src/websocket/handlers.js:76`) | Re-verifies membership; inserts `chat_messages`; updates sender's `last_read_message_id`; fans out `chat:message` to every other member and echoes to sender's own tabs (all in one `db.withTransaction`) |
| `chat:mark_read` | `{ channel_id, message_id }` | `onChatMarkRead` (`backend/src/websocket/handlers.js:160`) | Updates `chat_channel_members.last_read_message_id`; upserts `chat_message_reads`; recomputes unread count and pushes `chat:unread_update` to all of caller's tabs |
| `po:subscribe` | `{ po_id }` | `onPoSubscribe` (`backend/src/websocket/handlers.js:213`) | Placeholder — replies `po:subscribe:ack` only. Real **[PO](../business/system-overview.md#glossary-po)** stage pushes are delivered via role broadcast, not per-PO subscription |

## Invariants

1. **All cross-process WS state lives nowhere — it is in-process only.** `userConnections` and `roleIndex` are plain JavaScript `Map` instances on the module-level `state` object (`backend/src/websocket/state.js:23`-`backend/src/websocket/state.js:27`); there is no Redis adapter and no `ws-cluster` plug-in. Consequence: with `N > 1` API nodes, a `sendToUser(userId, ...)` call lands only on connections held by the **same process** that ran the call. See `CLAUDE.md` ("No in-memory session state — sessions in Redis; the system must be horizontally scalable") — sessions comply, but the WS connection registry currently does not. Until a Redis pub/sub fan-out layer is added, a multi-node deploy needs sticky sessions on `/api/ws` (Traefik per-source-IP) or domain events must be re-published through Redis so every node's emitter can fan out locally. Enforced (and accurately reflected) by `state.registerConnection` (`backend/src/websocket/state.js:29`) and `state.getUserConnections` (`backend/src/websocket/state.js:64`).

2. **Domain code never reaches into `emitter.js` or `server.js` directly — it goes through `websocket/index.js`.** The facade re-exports the four fan-out helpers; the internal split is allowed to change as long as the facade contract holds. Enforced by convention and by the comments at `backend/src/websocket/index.js:5` and `backend/src/websocket/emitter.js:7`. Verified by `grep -rn "require.*websocket" backend/src/services` — every service imports `../websocket`, never `../websocket/emitter` or `../websocket/server`.

3. **Authentication is enforced at the upgrade boundary, before any frame is read.** A failing JWT verify, a missing user, or a non-active account writes HTTP 401 and destroys the socket without ever calling `wss.handleUpgrade`. Enforced by `authenticateUpgrade` (`backend/src/websocket/server.js:56`) and the upgrade handler (`backend/src/websocket/server.js:189`-`backend/src/websocket/server.js:207`).

4. **Inbound handlers re-verify authorization on every write — they never trust `socket.userContext` alone for resource access.** `onChatJoinChannel` re-checks `chat_channel_members` (`backend/src/websocket/handlers.js:47`), `onChatSendMessage` re-checks inside the transaction (`backend/src/websocket/handlers.js:87`), `onChatMarkRead` requires the update to match a member row (`backend/src/websocket/handlers.js:167`). Matches `CLAUDE.md` "RBAC enforced at all three layers".

5. **Realtime delivery is best-effort, never durable.** If the user is offline the frame is dropped and `sendToUser` returns `0` (`backend/src/websocket/emitter.js:47`). Notifications, chat, and **[PO](../business/system-overview.md#glossary-po)** tracking remain authoritative through their REST list endpoints. Enforced by `safeSend` (`backend/src/websocket/emitter.js:29`) and the readyState check.

6. **Outbound frames always use the `{ event, data, ts }` envelope.** The frontend can subscribe with a single message handler and dispatch on `event`. Enforced by `serialize` (`backend/src/websocket/emitter.js:21`) — every helper routes through it. Note: hand-rolled `socket.send` calls inside `server.js` and `handlers.js` (e.g. `ws:connected`, `chat:joined`, `<event>:error`) construct the envelope manually and must keep the same three keys.

7. **`attach()` is idempotent — calling it twice is a no-op.** `state.getServer()` returns the cached `WebSocketServer` and the second call logs and returns a stub (`backend/src/websocket/server.js:168`-`backend/src/websocket/server.js:172`). Test harnesses that share a process across suites rely on this.

## Extension points

- **Add a new outbound event.** Emit from the service layer via the facade: `const ws = require('../websocket')` then `ws.sendToUser(userId, 'feature:event_name', payload)` (or `sendToUsers` / `sendToRole`). Pattern reference: `backend/src/services/notification.service.js:176` (per-user), `backend/src/services/po.service.js:340` (per-role). Use `setImmediate` to defer the push until after the surrounding DB transaction commits — the realtime layer reads through the shared pool, so an uncommitted write in the transaction client is invisible to the follow-up query that builds the payload (see the pattern at `backend/src/services/notification.service.js:166`-`backend/src/services/notification.service.js:168`). Add the event to the table above so the frontend catalogue stays in sync.

- **Add a new inbound message.** Write `onFeatureAction(socket, data)` in `backend/src/websocket/handlers.js` — return early via `replyError(socket, '<event>', message)` for validation failures, never throw upward. Re-verify authorization against the database (`socket.userContext.userId` is trustworthy for identity, but channel / **[PO](../business/system-overview.md#glossary-po)** / row-level access must be re-checked per write — see `onChatSendMessage`). Register the handler in the frozen `HANDLERS` map (`backend/src/websocket/handlers.js:225`). Update the inbound table above.

- **Multi-node fan-out.** When the system scales past a single API node, add a Redis pub/sub bridge: each domain service publishes the `{ scope, event, data }` envelope to a Redis channel; every API node subscribes and re-runs `emitter.send*` against its **local** `state` registry. The facade in `index.js` is the right place to swap in this bridge — services keep calling `sendToUser` and don't notice. Until then, sticky-session `/api/ws` at Traefik.

- **New scope (e.g. send-to-channel).** Add a `getUsersForChannel` helper to `state.js` (or maintain a `channelIndex`), expose `sendToChannel` from `emitter.js`, and re-export it from `index.js`. Do **not** scatter membership lookups across services — the registry module owns scope resolution.

<!--
drift-anchors:
- backend/src/websocket/index.js
- backend/src/websocket/server.js
- backend/src/websocket/state.js
- backend/src/websocket/emitter.js
- backend/src/websocket/handlers.js
- backend/src/app.js
- backend/src/services/notification.service.js
- backend/src/services/po.service.js
- backend/src/config/env.js
- docs/backend/notifications.md
- docs/backend/po-state-machine.md
- CLAUDE.md
-->

---
audience: dev
reading_time: 6 min
last_reviewed: 2026-04-27
---

# Backend architecture

## Mental model

The backend is a single Express app exported from `backend/src/app.js`. Every request flows through a fixed middleware chain — global concerns (CORS, helmet, structured request logging, JSON body parsing) attach at app level, then per-route concerns (rate limiting on auth endpoints, JWT auth, RBAC capability check, Joi validator, handler) compose in front of each route. All responses leave the app through a single error envelope. The same Node process owns three side-channels: the HTTP listener (Express), an in-process job scheduler (single-leader via `SCHEDULER_ENABLED`), and a WebSocket server attached to the same HTTP listener at `/api/ws`. Persistent state lives in Postgres (domain), Redis (sessions, refresh tokens; rate-limit counters move to Redis in multi-node deploys), and MinIO (file bytes); the only in-memory state is scheduler bookkeeping and the per-process WS connection registry. Horizontal scaling is therefore a matter of running N stateless API nodes with `SCHEDULER_ENABLED=true` on exactly one of them.

## Wiring

Request lifecycle for an authenticated, RBAC-gated, validated route (e.g. `POST /api/sales/customers`):

```
client
  │  HTTP(S) request
  ▼
Traefik (edge proxy, sets X-Forwarded-For, X-Request-Id)
  │
  ▼
Express app  (backend/src/app.js)
  │
  ├─ trust proxy = 1                                       app.js:28
  ├─ cors({ origin: env.corsOrigin, credentials: true })   app.js:36
  ├─ helmet({ csp: false, corp: false })                   app.js:37
  ├─ requestLogger  (assigns req.id, schedules finish log) app.js:47
  ├─ express.json({ limit: '1mb' })                        app.js:48
  │
  ├─► route mount  /api/sales → salesRoutes                app.js:53
  │     │
  │     ├─ authMiddleware            (Bearer JWT → req.user)
  │     ├─ rbacGuard(feature, cap)   (role_permissions lookup, attaches req.roleScope)
  │     ├─ validate({ body|params|query })  (Joi, replaces req.* with coerced value)
  │     └─ handler  (calls service, returns success(data, meta?))
  │
  ├─ /api 404 fallback                                     app.js:64
  └─ errorHandler  (AppError → typed envelope; else 500)   app.js:68
```

Response envelopes (verified in `backend/src/utils/response.js:3-13`):

- 2xx success: `{ success: true, data, meta? }`
- 4xx/5xx failure: `{ success: false, error: <message>, code: <slug>, details? }`

The `code` slugs are stable strings (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unprocessable`, `rate_limited`, `internal_error`). The first six slugs (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unprocessable`) are defined as `AppError` subclasses in `backend/src/utils/errors.js:12-48`; `internal_error` is the `AppError` default at `backend/src/utils/errors.js:4`; `rate_limited` is emitted directly from `backend/src/middleware/rateLimit.middleware.js:32`. Frontend should branch on `code`, not on the human-readable `error` string.

Sidecars on the same process:

- **Scheduler.** `app.js:79` calls `scheduler.start()`. If `SCHEDULER_ENABLED=false` the job module logs and no-ops (`backend/src/jobs/scheduler.js:138-143`). SLA jobs (Technical Ready-to-Deliver 2-day, PO 30-day reminder, **[HRGA](../business/system-overview.md#glossary-hrga)** 90/30-day expiry, tax deadline monitor; the Sales PO 2-working-day SLA from `CLAUDE.md` is not yet implemented in `backend/src/jobs/`) live in `backend/src/jobs/` (see [jobs.md](./jobs.md) once written for cron schedules, overlap rules, and working-day math).
- **WebSocket.** `app.js:84` calls `websocket.attach(server)`. The WS server only owns the `/api/ws` path (`backend/src/websocket/server.js:32`); any other upgrade request falls through, so the same TLS/port can later host other upgrade routes without conflict (see [websocket.md](./websocket.md) once written for the connection lifecycle and event catalogue).
- **Graceful shutdown.** SIGTERM/SIGINT close the WS, stop the scheduler, then close the HTTP server, with a 10-second hard-exit fallback (`app.js:89-99`).

## Key files

| File | Purpose | Principal export |
|---|---|---|
| `backend/src/app.js` | Express app composition, route mounts, sidecar wiring, graceful shutdown | `app.js:102` (`module.exports = app`) |
| `backend/src/middleware/auth.middleware.js` | Verifies HS256 Bearer JWT, loads active user, attaches `req.user` | `auth.middleware.js:60` (`authMiddleware`) |
| `backend/src/middleware/rbac.middleware.js` | `rbacGuard(featureKey, capabilityKey)` — DB-driven capability check, attaches `req.roleScope` | `rbac.middleware.js:60` (`rbacGuard`) |
| `backend/src/middleware/validator.middleware.js` | `validate({body,params,query})` Joi runner; replaces request sections with coerced values | `validator.middleware.js:40` (`validate`) |
| `backend/src/middleware/errorHandler.middleware.js` | Catches `AppError` → typed envelope; otherwise logs and returns 500 | `errorHandler.middleware.js:23` (`errorHandler`) |
| `backend/src/middleware/requestLogger.middleware.js` | Mints/honours `X-Request-Id`, emits one JSON log line per finished request | `requestLogger.middleware.js:90` (`requestLogger`) |
| `backend/src/middleware/rateLimit.middleware.js` | Composite per-IP + per-email login limiter, RFC 6585 headers, 429 envelope | `rateLimit.middleware.js:90` (`loginRateLimiter`) |
| `backend/src/utils/response.js` | `success(data, meta?)` and `error(message, code?)` envelope builders | `response.js:15` |
| `backend/src/utils/errors.js` | `AppError` + `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UnprocessableError` | `errors.js:50` |
| `backend/src/jobs/scheduler.js` | In-process cron leader, gated by `SCHEDULER_ENABLED` | `scheduler.js:223` (`start`, `stop`) |
| `backend/src/websocket/server.js` | `attach(httpServer)` — owns `/api/ws`, returns `{ close }` | `websocket/server.js:235` (`attach`) |
| `backend/src/config/env.js` | Single source of truth for env-derived config (port, JWT, CORS, rate limits, logger) | `config/env.js:54` |

## Invariants

The architectural invariants in `CLAUDE.md` are enforced at specific code sites. Do not move or weaken these — every later module spec relies on them.

### 1. RBAC enforced at three layers (frontend, backend, DB scope)

The backend layer is `rbacGuard` (`rbac.middleware.js:13-58`). The capability matrix is **never** hardcoded — `rbacGuard` joins `role_permissions` × `roles` × `feature_definitions` × `capability_definitions` per request (`rbac.middleware.js:36-47`). **[Superadmin](../business/system-overview.md#glossary-superadmin)** and **[CEO](../business/system-overview.md#glossary-ceo)** short-circuit at `rbac.middleware.js:32-34`; every other role — **[Sales](../business/system-overview.md#glossary-sales)**, **[Admin & Log](../business/system-overview.md#glossary-admin-log)**, **[Finance](../business/system-overview.md#glossary-finance)**, **[Technical](../business/system-overview.md#glossary-technical)**, **[HRGA](../business/system-overview.md#glossary-hrga)**, **[Tax & Insurance](../business/system-overview.md#glossary-tax-insurance)** — must have an explicit grant of `(role, feature, capability)` or the matching `full_access`. A 403 here is canonical: do not catch it in route handlers. See [auth-and-rbac.md](./auth-and-rbac.md) for the full role × capability matrix, login flow, and same-role enforcement details.

### 2. Same-role management constraint

`rbacGuard` always attaches `req.roleScope = { managed_role_scope, can_manage_same_role, feature_permission_scope }` from `user_role_scope` (`rbac.middleware.js:20-30`). Service code that creates/edits users **must** consult `req.roleScope` server-side; the frontend may surface the scope, but the trust boundary is the service. Example call shape:

```js
// excerpt — backend/src/routes/sales.routes.js
router.post(
  '/customers',
  rbacGuard('customers', 'create'),
  validate({ body: v.customerCreate }),
  asyncHandler(async (req, res) => { /* uses req.user, req.roleScope */ }),
);
```

### 3. 11-stage **[PO](../business/system-overview.md#glossary-po)** lifecycle is the backbone

Stage transitions are not a concern of `app.js` — they are owned by the service layer (e.g. `services/sales.service.js`, `services/finance.service.js`). The middleware chain only guarantees that an authenticated, authorized, validated request reaches the service. A transition handler must (1) write `purchase_order_status_history`, (2) write `purchase_order_tracking_events`, (3) emit the matching notification, (4) update `purchase_orders.current_status` — in one transaction. **[AWB](../business/system-overview.md#glossary-awb)**, **[DO](../business/system-overview.md#glossary-do)**, **[PR PO-Out](../business/system-overview.md#glossary-pr-po-out)**, **[BAST](../business/system-overview.md#glossary-bast)** field writes are the documented automation triggers. See [po-state-machine.md](./po-state-machine.md) for the per-stage transition contracts and the full automation matrix.

### 4. Notifications are event-driven

Domain events emit to `NotificationService`; templates in `notification_templates` gate enablement (see [notifications.md](./notifications.md) once written for the template-gating contract). Route handlers do not call mailers or WS emitters directly — they delegate to the service, which calls the notification layer. The WS emitter (`backend/src/websocket/emitter.js`) is the only path that talks to connected clients.

### 5. SLA monitoring runs as scheduled jobs

In-request handlers must not perform SLA escalation. The scheduler (`jobs/scheduler.js`) is the single owner of working-day deadline checks. Run exactly one node with `SCHEDULER_ENABLED=true`; all others must run with it off (`scheduler.js:138-143`).

### 6. File attachments

MinIO is the byte store; `file_attachments` is the metadata of record. Buckets are private; clients receive presigned URLs (download 15 min, upload 5 min) — see `backend/src/config/minio.js` for the client and the `/api/files` routes (`app.js:59`) for issuance.

### 7. Audit trail

Mutating routes capture actor identity from `req.user` (set at `auth.middleware.js:48-53`) and persist `updated_by_user_id`, `updated_by_role`, timestamp, and reason-if-delayed at the service layer. The request logger captures only metadata for ops (`requestLogger.middleware.js:67-77`); it is not an audit log.

### 8. Schema contract

UUID v4 PKs, `timestamptz` everywhere, soft-delete via `deleted_at`, parameterized SQL only. `auth.middleware.js:35-46` is the canonical example: parameterized lookup, rejects `deleted_at IS NOT NULL` and `account_status != 'active'`.

### 9. No in-memory session state

Sessions and refresh tokens live in Redis. The only in-memory state in this process is scheduler bookkeeping and the WS connection registry (per-process). The default rate-limit store is in-process memory — for multi-node deploys, swap in `rate-limit-redis` against `REDIS_URL` (`rateLimit.middleware.js:16-22`); the middleware shape stays the same.

### 10. Single error envelope

`errorHandler` is registered last (`app.js:68`). `AppError` subclasses carry `status` + `code` + optional `details`; everything else becomes a 500 with `code: 'internal_error'` (`errorHandler.middleware.js:9-21`). Do not `res.status(...).json(...)` ad-hoc error shapes inside handlers — throw the typed error and let the handler envelope it.

## Extension points

### Add a new module

1. Create `backend/src/services/<mod>.service.js` (pure functions, takes `db` + DTOs, returns rows / throws `AppError` subclasses).
2. Create `backend/src/validators/<mod>.validators.js` (Joi schemas exported by name; `validate()` consumes `{ body, params, query }`).
3. Create `backend/src/routes/<mod>.routes.js`. Mount `authMiddleware` once at the router (see `routes/sales.routes.js:15`) and apply `rbacGuard(feature, capability)` + `validate(...)` per route. Wrap async handlers in the local `asyncHandler` to forward rejections to `errorHandler`.
4. Mount the router in `app.js` next to the others (`app.js:52-61`). Pick a stable `/api/<mod>` prefix; the `/api` 404 fallback (`app.js:64`) catches typos.
5. Seed `feature_definitions`, `capability_definitions`, and `role_permissions` rows in a migration. Without DB grants, every non-Superadmin/CEO call returns 403.

### Add a new middleware

Register it in `app.js` between request logging (`app.js:47`) and the route mounts (`app.js:52`) for a global concern; or inline it on a router for a route-scoped concern (compose it before `validate` if it depends on the raw request, after if it depends on coerced values). Throw `AppError` subclasses — the global `errorHandler` will envelope them.

### Add a new error type

Subclass `AppError` in `backend/src/utils/errors.js` with a fixed `status` and a stable `code` slug, then add it to `module.exports` (`errors.js:50`). The slug becomes part of the public API — do not rename existing ones.

### Add a new scheduled job

Add `<name>.job.js` under `backend/src/jobs/` exporting a `run()` function. Register it in `scheduler.js`'s `start()` block, gated by the same `SCHEDULER_ENABLED` switch. Use the working-day utility (per `IMPL_backend.txt` Phase B1 contract) for SLA math; never compute deadlines with raw `Date` arithmetic inside the job.

### Add a new WebSocket event

Add an emitter helper in `backend/src/websocket/emitter.js` (the only module that talks to connected clients). Domain services call the emitter — handlers do not. Subscribe paths and auth happen in `websocket/server.js` and `websocket/handlers.js`; rooms / scopes are derived from the JWT-resolved user, not from client-supplied identifiers.

<!--
drift-anchors:
- backend/src/app.js
- backend/src/middleware/auth.middleware.js
- backend/src/middleware/rbac.middleware.js
- backend/src/middleware/validator.middleware.js
- backend/src/middleware/errorHandler.middleware.js
- backend/src/middleware/requestLogger.middleware.js
- backend/src/middleware/rateLimit.middleware.js
- backend/src/utils/response.js
- backend/src/utils/errors.js
- backend/src/routes/sales.routes.js
- backend/src/jobs/scheduler.js
- backend/src/websocket/server.js
- backend/src/websocket/index.js
- backend/src/config/env.js
- CLAUDE.md
-->

---
audience: operator
reading_time: 6 min
last_reviewed: 2026-04-27
---

# Incidents

## Purpose

Open this file first when something is broken. It is a symptom-keyed
catalogue: find the symptom, do the one-line first-response, then jump to
the detail runbook that owns the underlying subsystem. No deep procedures
live here — they live in `./deployment.md`, `./database.md`,
`./scheduler.md`, and `./storage.md`. This file's job is to route you to
the right one fast.

## Prerequisites

- SSH access to the VPS at `51.79.146.14`.
- `docker` and `docker compose` available on the host (run as a user in
  the `docker` group).
- Working knowledge of the four sibling runbook files:
  - [Deployment](./deployment.md) — Traefik, container builds, env vars,
    rollback.
  - [Database](./database.md) — Postgres, migrations, seeding.
  - [Scheduler](./scheduler.md) — cron jobs, SLA escalation, leader
    election.
  - [Storage](./storage.md) — MinIO buckets, presigned URLs.
- Read-access to the repo-root `.env` on the VPS (for env-var lookup, not
  for editing).

## Procedures

### Procedure: Triage

The triage flow is symptom-first. Walk it top-to-bottom; stop at the first
match and follow the link.

```
START
  |
  +-- Is the site reachable at all?
  |     |
  |     +-- No (browser shows 502/504/connection refused on app.* or api.*)
  |     |     -> See "app.* 502/504" or "api.* 5xx" below
  |     |     -> Likely deployment.md (Traefik / container down)
  |     |
  |     +-- Yes, but TLS warning
  |           -> See deployment.md "TLS cert renewal failed"
  |
  +-- Is the site up but logins fail?
  |     -> See "Login fails for everyone" below
  |     -> Likely database.md (DB unreachable) or env (JWT_SECRET drift)
  |
  +-- Site up, logins work, but a specific surface is broken?
  |     |
  |     +-- No notifications arriving (email or in-app)
  |     |     -> See "Notifications stopped firing" below
  |     |     -> See ../backend/notifications.md
  |     |
  |     +-- SLA escalation didn't fire on a known-overdue PO
  |     |     -> See "SLA escalation didn't happen" below
  |     |     -> Likely scheduler.md (scheduler not leader, job skipped)
  |     |
  |     +-- File preview / download returns an error
  |     |     -> See "File downloads broken" below
  |     |     -> Likely storage.md (presigned URL host mismatch)
  |     |
  |     +-- WebSocket reconnect loops, "live" badges stale
  |     |     -> See "WebSocket disconnections" below
  |     |     -> See ../backend/websocket.md
  |     |
  |     +-- A PO jumped a stage, or two stage rows appear back-to-back
  |           -> See "Unexpected PO stage transitions" below
  |           -> Likely scheduler.md (duplicate leader) or
  |              ../backend/po-state-machine.md (automation race)
  |
  +-- Background job didn't run at all
        -> See "Scheduled jobs missing" via "SLA escalation didn't happen"
        -> Always start in scheduler.md
```

**First-checks regardless of symptom** (run these before opening any
detail file):

```bash
# 1. Are the two app containers up?
docker ps --filter name=interlab- --format 'table {{.Names}}\t{{.Status}}'

# 2. What did the API log in the last 200 lines?
docker logs --tail 200 interlab-api

# 3. Are dependencies reachable from the API container?
docker exec interlab-api node -e "require('./src/config/db').query('select 1').then(()=>console.log('db ok')).catch(e=>console.error('db fail',e.code))"
```

If any of these three fail, the failure is infrastructure-level and
belongs in `./deployment.md` or `./database.md` regardless of the
user-visible symptom.

## Failure modes

Each entry below is intentionally short: one line to detect, one line to
respond, one link to the file that owns the deep procedure. If you find
yourself reading more than three lines here, you are in the wrong file —
follow the link.

### Failure: app.interlab-portal.com 502/504

- **Detect:** Browser returns 502 Bad Gateway or 504 Gateway Timeout on
  `https://app.interlab-portal.com`.
- **First response:** `docker ps | grep interlab-app` — if missing or
  restarting, the Next.js container is down or unhealthy upstream of
  Traefik.
- **Owner:** [./deployment.md](./deployment.md) — section "Failure:
  Traefik 502/504" and "Failure: Backend container restart-looping".

### Failure: api.interlab-portal.com 5xx

- **Detect:** Frontend shows toasts like "Internal server error" or
  network tab shows 5xx on `api.interlab-portal.com/api/*`.
- **First response:** `docker logs --tail 200 interlab-api` and look for
  the `[unhandled]` prefix (non-`AppError` exceptions are logged with
  that tag from `errorHandler.middleware.js`); a stack trace there is the
  root cause. If the log shows DB connection errors, jump to the database
  runbook instead.
- **Owner:** [./deployment.md](./deployment.md) for container/process
  issues; [./database.md](./database.md) if the trace is a Postgres
  connection or query failure.

### Failure: Login fails for everyone

- **Detect:** Every account — including known-good demo users — gets
  "Invalid credentials" or a 5xx on POST `/api/auth/login`.
- **First response:** Confirm Postgres is reachable
  (`docker exec interlab-api node -e "require('./src/config/db').query('select 1')"`);
  if that fails, the DB is the problem. If the DB is fine, check that
  `JWT_SECRET` and `JWT_REFRESH_SECRET` in the running container match
  what tokens were signed with — a recent redeploy with a new secret
  invalidates every refresh token.
- **Owner:** [./database.md](./database.md) for DB-down; otherwise
  [./deployment.md](./deployment.md) for env-var drift.

### Failure: Notifications stopped firing

- **Detect:** A workflow event that should produce in-app or email
  notifications produces neither; recipients report silence.
- **First response:** Confirm `notification_templates.is_enabled = true`
  for the event in question (a disabled template suppresses **all**
  delivery, by design — see CLAUDE.md). If the template is enabled and
  in-app notifications still don't appear, the dispatch path is broken.
  Note: as of the last review, the `email_dispatch` worker is **not
  implemented** — email failures are expected until that ships.
- **Owner:** [../backend/notifications.md](../backend/notifications.md)
  for the dispatch model and current delivery gaps.

### Failure: SLA escalation didn't happen

- **Detect:** A PO breached its 2-working-day Sales deadline (or another
  SLA window) and no escalation notification went out.
- **First response:** `docker exec interlab-api env | grep SCHEDULER_ENABLED`
  must show `true` on exactly one node; `docker logs interlab-api | grep
  '\[scheduler\]'` should show `registered job=...` lines on startup and
  per-tick run lines.
- **Owner:** [./scheduler.md](./scheduler.md) — leader election, manual
  run, "previous run still in flight" recovery.

### Failure: File downloads broken

- **Detect:** Clicking a file in any module returns 403, "Signature does
  not match", or the browser hangs on a MinIO host that does not resolve.
- **First response:** Confirm `MINIO_PUBLIC_URL` in the running API
  container matches the S3 API host the browser downloads from
  (`https://s3-storage.interlab-portal.com`). It should not point at the
  Console UI (`https://s3-minio.interlab-portal.com`). A mismatch between
  sign-time and resolve-time host produces `SignatureDoesNotMatch`.
  Presigned URLs expire after 15 minutes for download — a stale tab will
  403 even when everything is healthy.
- **Owner:** [./storage.md](./storage.md) — bucket privacy, presigned
  URL TTLs, credential rotation.

### Failure: WebSocket disconnections

- **Detect:** "Live" indicators stop updating; the browser console shows
  WS reconnect loops on `wss://api.interlab-portal.com/api/ws`.
- **First response:** Check the API container is up and the WS upgrade
  is reaching it (Traefik logs, then `docker logs interlab-api | grep
  -i socket`). Note the multi-node caveat: the current implementation
  keeps user-to-socket maps in-process (in-memory `Map`s), so a second
  replica will silently drop cross-node delivery — running more than one
  API replica is not safe today.
- **Owner:** [../backend/websocket.md](../backend/websocket.md) — the
  in-process state limitation and the migration path to a Redis adapter.

### Failure: Unexpected PO stage transitions

- **Detect:** A PO advances a stage no one set, or
  `purchase_order_status_history` shows two rows for the same transition
  within seconds of each other.
- **First response:** Most likely cause is two scheduler leaders running
  at once (duplicate cron firings). Check `SCHEDULER_ENABLED` on every
  replica — exactly one must be `true`. Second-most-likely cause is an
  automation race where two field writes both trigger the same stage
  transition (AWB → Shipped, DO → Delivery, etc.); the state machine is
  designed to be idempotent but a race can still produce duplicate
  audit rows.
- **Owner:** [./scheduler.md](./scheduler.md) for duplicate-leader
  cleanup; [../backend/po-state-machine.md](../backend/po-state-machine.md)
  for automation trigger semantics.

## Reference

### Container names

| Container          | Role                                |
|--------------------|-------------------------------------|
| `interlab-api`     | Node.js API + Socket.IO (port 4000) |
| `interlab-app`     | Next.js frontend (port 3000)        |
| `interlab-postgres`| Postgres (shared infra container)   |
| `interlab-redis`   | Redis (shared infra container)      |
| `interlab-minio`   | MinIO object store (shared infra)   |
| `traefik`          | Reverse proxy + TLS (shared infra)  |

The Postgres, Redis, and MinIO containers are **not** managed by
`docker-compose.demo.yml` in this repo — they run on the VPS as shared
infrastructure on the `interlab-data-net` network. The compose file in
this repo only owns `interlab-api` and `interlab-app`.

### Log locations

- API application logs: `docker logs interlab-api` (stdout — pino JSON,
  pipe to `| jq` to read).
- Frontend logs: `docker logs interlab-app` (Next.js stdout).
- Postgres / Redis / MinIO: `docker logs interlab-postgres` (and the
  others) — these run outside this repo's compose but the names are
  stable. For RedisInsight and Redis health checks, see
  [./redis.md](./redis.md).
- Traefik: `docker logs traefik` on the VPS — useful for routing,
  TLS, and 502/504 root cause.
- Unhandled-exception marker: backend prints `[unhandled]` to stderr
  before returning the generic `internal_error` envelope from
  `errorHandler.middleware.js` in non-production; in production only the
  envelope is returned, so `docker logs interlab-api` is the only place
  to see the original stack.

### Traefik dashboard

The Traefik instance on this VPS does not expose a public dashboard.
Inspect routing via `docker exec traefik traefik healthcheck` and the
container's logs.

### Escalation contact

This system is operated solo. If a procedure in the linked detail file
does not resolve the incident, escalate to the lead developer — see
[../business/system-overview.md](../business/system-overview.md) for
team context. There is no on-call rotation; there is no second-line.
Document what you saw, what you tried, and the timestamps in the
incident notes before handing off.

<!-- drift-anchors:
  docs/runbook/deployment.md
  docs/runbook/database.md
  docs/runbook/redis.md
  docs/runbook/scheduler.md
  docs/runbook/storage.md
  docs/backend/notifications.md
  docs/backend/websocket.md
  docs/backend/po-state-machine.md
  backend/src/middleware/errorHandler.middleware.js
  docker-compose.demo.yml
  CLAUDE.md
-->

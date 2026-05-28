---
audience: dev
reading_time: 3 min
last_reviewed: 2026-04-27
---

# Interlabs CRM

Internal CRM + ERP + Realtime Operations Hub for PT. Interlab Sentra Solutions Indonesia. Indonesian business locale, IDR primary currency, Asia/Jakarta timezone. Deploys to a single Ubuntu VPS via Docker + Traefik, serving `app.interlab-portal.com` (Next.js) and `api.interlab-portal.com` (Node API + WebSocket).

## Quickstart

1. Clone the repo onto the target host.
2. Populate the repo-root `.env` (use `backend/.env.example` for variable names; never copy actual secrets between environments).
3. Ensure prerequisites are running on the host: the `interlab-postgres`, `interlab-redis`, and `interlab-minio` containers attached to the `interlab-data-net` network, plus the platform Traefik reachable on `traefik_default`.
4. Build and start the stack:

   ```bash
   docker compose -f docker-compose.demo.yml up -d --build
   ```

Then browse `https://app.interlab-portal.com` (TLS is issued automatically by Traefik via Let's Encrypt).

The backend container's entrypoint auto-runs `wait-for-postgres -> migrate -> seed` on each start, so a fresh container brings the schema up to date without manual intervention.

## Repo layout

```
backend/                     Node 20 + Express API, ws, pg, MinIO client, scheduler. JS only.
frontend/                    Next.js 14 (App Router, standalone). TypeScript + Tailwind.
interlabs-crm-demo/docs/     Spec source-of-truth (10-file prompt pipeline; CTX_*, MOD_*, IMPL_*).
docs/                        Runtime documentation (this set).
```

## Documentation map

### Developers

Backend:

- [docs/backend/architecture.md](docs/backend/architecture.md) - Express + middleware chain + scheduler + WebSocket, the big-picture wiring
- [docs/backend/auth-and-rbac.md](docs/backend/auth-and-rbac.md) - JWT, refresh, 3-layer RBAC, same-role-management
- [docs/backend/po-state-machine.md](docs/backend/po-state-machine.md) - the 11-stage PO lifecycle, the 5 automations, audit-trail contract
- [docs/backend/notifications.md](docs/backend/notifications.md) - NotificationService, 42-template catalogue, the email-worker gap
- [docs/backend/websocket.md](docs/backend/websocket.md) - WS event catalogue + the in-process state caveat for multi-node
- [docs/backend/jobs.md](docs/backend/jobs.md) - 4 cron jobs, single-leader pattern, idempotency
- [docs/backend/modules/sales.md](docs/backend/modules/sales.md) - Sales module deep dive
- [docs/backend/modules/admin-log.md](docs/backend/modules/admin-log.md) - Admin & Logistics module deep dive
- [docs/backend/modules/finance.md](docs/backend/modules/finance.md) - Finance module deep dive
- [docs/backend/modules/technical.md](docs/backend/modules/technical.md) - Technical module deep dive
- [docs/backend/modules/hrga.md](docs/backend/modules/hrga.md) - HRGA / Legal module deep dive
- [docs/backend/modules/tax.md](docs/backend/modules/tax.md) - Tax & Insurance module deep dive

Frontend:

- [docs/frontend/architecture.md](docs/frontend/architecture.md) - Next.js App Router + AppShell route group
- [docs/frontend/state-and-forms.md](docs/frontend/state-and-forms.md) - Zustand stores, react-hook-form, shared form components
- [docs/frontend/api-layer.md](docs/frontend/api-layer.md) - axios instance + per-module trio
- [docs/frontend/rbac-and-nav.md](docs/frontend/rbac-and-nav.md) - frontend gating layer (UX, not security)

### Operators

- [docs/runbook/deployment.md](docs/runbook/deployment.md) - first-time deploy, update, rollback
- [docs/runbook/database.md](docs/runbook/database.md) - migrations, seeding, recovery
- [docs/runbook/redis.md](docs/runbook/redis.md) - Redis health checks, RedisInsight over SSH tunnel
- [docs/runbook/scheduler.md](docs/runbook/scheduler.md) - leader confirmation, manual fire, multi-node guidance
- [docs/runbook/storage.md](docs/runbook/storage.md) - MinIO bucket bootstrap, presigned URL debugging
- [docs/runbook/incidents.md](docs/runbook/incidents.md) - symptom-keyed triage entry point

### Stakeholders

- [docs/business/system-overview.md](docs/business/system-overview.md) - what the system does, who uses it, glossary
- [docs/business/roles-and-permissions.md](docs/business/roles-and-permissions.md) - 8 roles in business terms
- [docs/business/sla-policies.md](docs/business/sla-policies.md) - every SLA in plain English
- [docs/business/audit-and-compliance.md](docs/business/audit-and-compliance.md) - what we log, how access is protected
- [docs/business/data-handling.md](docs/business/data-handling.md) - data residency, file privacy, retention

## Where to start

- I want to deploy -> [docs/runbook/deployment.md](docs/runbook/deployment.md)
- I want to add a backend route -> [docs/backend/architecture.md](docs/backend/architecture.md), then the relevant [docs/backend/modules/](docs/backend/modules/) file
- I want to understand the PO lifecycle -> [docs/backend/po-state-machine.md](docs/backend/po-state-machine.md)
- I'm new to the frontend -> [docs/frontend/architecture.md](docs/frontend/architecture.md)
- Something is broken -> [docs/runbook/incidents.md](docs/runbook/incidents.md)
- I'm not technical and want to know what this system does -> [docs/business/system-overview.md](docs/business/system-overview.md)

## Project conventions

- Non-negotiable architectural invariants live in [CLAUDE.md](./CLAUDE.md).
- Implementation is built incrementally via the prompt pipeline at `interlabs-crm-demo/docs/PIPELINE_README.txt` (specs feed Claude session-by-session).
- Each runtime doc carries an `audience:` frontmatter and a `<!-- drift-anchors -->` block listing the source files it mirrors.

<!-- drift-anchors:
  CLAUDE.md
  docker-compose.demo.yml
  backend/package.json
  frontend/package.json
  docs/
-->

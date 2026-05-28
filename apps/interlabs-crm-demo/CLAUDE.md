# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The repo contains both the prompt-pipeline specs (`interlabs-crm-demo/docs/`) and a partially built implementation:

- `backend/` — Node 20 + Express API, `ws` for WebSockets, `pg` for Postgres, `minio` client, `node-cron` scheduler, JWT auth, Joi validators. Plain JavaScript (no TS, no test runner yet).
- `frontend/` — Next.js 14 (App Router, standalone output), React 18, Tailwind, Zustand, react-hook-form + zod, axios, sonner, `@tanstack/react-table`, lucide-react. TypeScript.
- `backend/migrations/` — 16 numbered SQL files; the runner is `backend/scripts/migrate.js`.
- `docker-compose.demo.yml` — demo deployment that piggybacks on infrastructure already running on the VPS (`interlab-postgres`, `interlab-redis`, `interlab-minio`, Traefik on `traefik_default`).

The work this repo drives is a production CRM + ERP + Realtime Operations Hub for PT. Interlab Sentra Solutions Indonesia (Indonesian business locale, IDR primary currency). The deployment target is defined in `/opt/projects/interlabs-crm-demo/.env`: a single Ubuntu VPS (`51.79.146.14`) running Docker with Traefik, serving `app.interlab-portal.com` (Next.js) + `api.interlab-portal.com` (Node API + WebSocket on `/api/ws`), backed by Postgres, Redis, and MinIO. That `.env` contains live secrets (DB, JWT, SMTP, MinIO credentials) — never commit edits that leak or move those values. **The backend reads the repo-root `.env` (not `backend/.env`)** via `backend/src/config/env.js`; `backend/.env.example` is the template that documents the canonical variable names, but `env.js` accepts deployed aliases (e.g. `MINIO_HOST`/`MINIO_ROOT_USER`/`S3_BUCKET` alongside `MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_BUCKET_*`, and `REFRESH_TOKEN_SECRET` alongside `JWT_REFRESH_SECRET`) so production and dev share one file.

## Common commands

Backend (run from `backend/`):

- `npm install` — install deps (lockfile is committed for reproducible test runs).
- `npm run dev` — `node --watch src/app.js`. Hot-reloads on file change.
- `npm start` — `node src/app.js`.
- `node scripts/wait-for-postgres.js` — block until Postgres is reachable (used by the Docker entrypoint).
- `node scripts/migrate.js` — apply pending migrations. Idempotent: tracks applied filenames in `schema_migrations`. Migration files use `-- +migrate Up` / `-- +migrate Down` markers; only the Up section runs. **A new migration must include both markers** or the runner will execute the entire file.
- `node scripts/seed.js` — seed roles, capabilities, and demo users.
- `node scripts/seed_default_avatars.js` — upload default role avatars to MinIO at `avatars/defaults/{role}.png`. Run once on a fresh deploy after `migrate.js` + `seed.js`. Reads PNGs from `interlabs-crm-demo/pictures/interlab_role_avatar_generation/` (or `/avatars` if Docker-mounted). Idempotent: overwrites existing objects.
- `node -e "require('./src/jobs/scheduler').runOnce('<job_name>')"` — manually fire a single scheduled job (`sla_technical_ready_to_deliver`, `technical_po_due_reminder`, `hrga_expiry_monitor`, or `tax_deadline_monitor`). Bypasses cron but goes through the same overlap guard.

Frontend (run from `frontend/`):

- `npm install`, `npm run dev` (port 3000), `npm run build`, `npm start`, `npm run lint`.

Demo deployment:

- `docker compose -f docker-compose.demo.yml up -d --build` — build and start the demo stack. The backend Dockerfile entrypoint runs `wait-for-postgres → migrate → seed → app.js` automatically, so a fresh container will bring the schema up to date on boot.

There is **no test runner yet** — do not invent `npm test` commands.

## Implemented architecture

Load-bearing wiring that requires reading multiple files to discover:

- **API surface (`backend/src/app.js`)**: mounts `/api/auth`, `/api/sales`, `/api/finance`, `/api/admin-log`, `/api/technical`, `/api/hrga`, `/api/tax`, `/api/files`, `/api/activity-logs`, `/api/settings`. The WebSocket server attaches to the same HTTP listener at `/api/ws`. Health: `GET /health`. Unmatched `/api/*` returns a JSON 404 envelope; non-`/api/*` paths fall through.
- **Per-module backend layering**: `routes/{module}.routes.js` → middleware (`auth` → `rbac` → `validator`) → `validators/{module}.validators.js` (Joi) → `services/{module}.service.js`. Domain logic lives in services; routes are thin. `services/po.service.js` is the shared PO state-machine helper that all modules call into for stage transitions, status history, tracking events, and notification fan-out.
- **Cross-cutting services**: `notification.service.js` (event-driven; honors `notification_templates` enable flags), `email.service.js` (queued via `email_queue` table; SMTP), `file.service.js` (MinIO presigned URLs + `file_attachments` rows), `app_settings.service.js` (DB-backed config), `activity_log.service.js`.
- **Background jobs (`backend/src/jobs/scheduler.js`)**: four cron jobs in `Asia/Jakarta` — `sla_technical_ready_to_deliver` (hourly), `technical_po_due_reminder` (daily 08:00), `hrga_expiry_monitor` (daily 08:00), `tax_deadline_monitor` (monthly, 1st at 08:00). The scheduler runs in-process with the API. **Single-leader via `SCHEDULER_ENABLED`** — for horizontal scaling, set `SCHEDULER_ENABLED=false` on every instance except the designated leader. Per-job in-flight locks prevent overlapping ticks within a process; they do not coordinate across processes.
- **WebSocket layer (`backend/src/websocket/`)**: `server.js` (attach + auth), `state.js` (connection registry), `emitter.js` (`sendToUser`/`sendToUsers`/`sendToRole`/`broadcastAll`), `handlers.js` (inbound messages). Domain code imports from `websocket/index.js` only.
- **Frontend layout**: App Router with a `(app)` route group — `frontend/app/(app)/layout.tsx` mounts `AppShell` (sidebar + topbar + auth guard + notification dropdown + theme bootstrap). `frontend/app/login/` is outside the group. Module pages live under `app/(app)/{sales,finance,admin-log,technical,hrga,tax,...}/...` with the standard `page.tsx` / `new/page.tsx` / `[id]/page.tsx` / `[id]/edit/page.tsx` shape.
- **Frontend per-module trio (`frontend/lib/`)**: each module owns `{module}-api.ts` (axios calls), `{module}-types.ts` (TS types), `{module}-ui.ts` (status colors, label maps, formatters). Cross-module shared code: `api.ts` (axios instance), `auth.ts`, `rbac.ts`, `websocket.ts`, `utils.ts`, `env.ts`. Stores: `stores/{auth,notification,sidebar,theme}.store.ts` (Zustand).
- **Trust proxy**: `app.set('trust proxy', 1)` — single-hop (Traefik). If you add another proxy hop, bump the count or `req.ip` will reflect the wrong address and the rate limiter will be defeated.

## The prompt pipeline (how this repo is meant to be used)

`interlabs-crm-demo/docs/` holds a 10-file prompt pipeline designed to be fed to Claude across multiple focused sessions. Order matters — `PIPELINE_README.txt` is the authoritative playbook. In every session, inject `CTX_master_context.txt` first (the domain model), then the relevant context/module/impl file(s):

- `CTX_master_context.txt` — domain model, roles, PO lifecycle, SLAs, notification system, RBAC matrix, core tables. Always first.
- `CTX_architecture.txt` — system layers, API route map, WebSocket event catalogue, MinIO bucket strategy, background job schedule, security.
- `MOD_sales.txt`, `MOD_admin_log.txt`, `MOD_finance.txt`, `MOD_technical.txt`, `MOD_hrga.txt`, `MOD_tax_insurance.txt` — one per division; each defines that division's forms, fields, and cross-division triggers.
- `IMPL_backend.txt` — phased backend generation plan (B1 setup → B2 migrations → … → B8 WebSocket). Generate in order, validate each phase before the next.
- `IMPL_frontend.txt` — phased frontend plan (F1 setup → F2 auth → AppShell → module pages → global pages). Do not build module pages before AppShell + shared components exist.

Generated code lives under `backend/` and `frontend/` at the repo root. The `interlabs-crm-demo/docs/` directory is spec, not output.

## Non-negotiable architectural invariants

These bind every module. Any code you produce must honor them; never simplify or merge them away, even if a module spec looks repetitive.

- **8 roles, scope-enforced at 3 layers**: Superadmin, CEO, Sales, Admin & Log, Finance, Technical, HRGA/Legal, Tax & Insurance. RBAC must be enforced in (1) frontend menu/component rendering, (2) backend route middleware, (3) database query scope. Never rely on frontend gating alone. The permission matrix lives in the DB (`roles`, `permissions`, `role_permissions`, `feature_definitions`, `capability_definitions`) — do not hardcode it in application code.
- **Same-role management constraint**: non-Superadmin/CEO role managers can only create/edit users whose role matches theirs. Enforce server-side via `managed_role_scope` / `can_manage_same_role_users`, not by trust.
- **11-stage PO lifecycle is the backbone**: Registered → Processed (Sales) → Production (Finance) → Shipped → Customs → Arrived (Admin & Log) → Inspected (Technical) → Delivery (Admin & Log) → Installation → BAST (Technical) → Invoice (Finance). Every stage transition **must** (1) insert into `purchase_order_status_history`, (2) insert into `purchase_order_tracking_events`, (3) fire the matching notification template if enabled, (4) update `purchase_orders.current_status`. Automations (AWB → Shipped/Customs/Arrived; DO → Delivery; PR PO-Out → Production; BAST → Invoice draft; Invoice Customer → Invoice) are triggered by specific field writes — wire them through `services/po.service.js`, not from ad-hoc controller logic.
- **Notifications are event-driven**: domain events emit to `NotificationService`; templates in `notification_templates` control enablement, recipients, and whether email/dashboard delivery fires. A disabled template suppresses *all* delivery for that event. Superadmin/CEO can toggle per-template or per-group.
- **SLA monitoring runs as scheduled jobs, not in request handlers**: Sales PO 2-working-day deadlines (escalation to Superadmin, CEO, Admin & Log, Finance), Technical Ready-to-Deliver 2-day response, Technical 30-day PO due reminder, HRGA 90/30-day expiry. Use working-day math (skip weekends) — see `backend/src/utils/workingDays.js`.
- **File attachments**: always store metadata in `file_attachments` even though bytes live in MinIO. MinIO buckets are private; access only via presigned URLs (download 15 min, upload 5 min).
- **Audit trail**: every workflow state change logs actor (`updated_by_user_id`, `updated_by_role`), timestamp, note, and reason-if-delayed. No silent mutations.
- **UUID v4 primary keys, `timestamptz` timestamps, soft deletes (`deleted_at`), `created_by`/`updated_by` on all mutable tables.** Parameterized SQL only.
- **No in-memory session state** — sessions in Redis; the system must be horizontally scalable. The scheduler is the only stateful in-process component, and it is single-leader by env flag.

## Working with the docs

- The docs are long and prescriptive on purpose. When a module spec enumerates fields, automations, or notification events, treat the list as exhaustive and mandatory — don't trim it because it looks like boilerplate.
- `CTX_master_context.txt` and `CTX_architecture.txt` disagree with any module file? `CTX_*` wins; module files extend, they don't override.
- If asked to build one division, still load `CTX_master_context.txt` + the relevant `MOD_*` file — module specs reference shared concepts (PO stages, notification system, RBAC capabilities) defined only in the CTX files.

## Assets

`interlabs-crm-demo/pictures/company_logo/` holds logo variants (login page, sidebar). `interlabs-crm-demo/pictures/interlab_role_avatar_generation/` holds per-role default avatars — these map to the MinIO path `avatars/defaults/{role}.png` documented in `CTX_architecture.txt`.

## Execution rules
- Follow PIPELINE_README.txt phase order unless explicitly told otherwise.
- Do not skip from architecture/design directly into full implementation.
- Do not ask for permission before safe file edits.
- Do not commit or push automatically.
- Generate code under `backend/` and `frontend/`, never inside `interlabs-crm-demo/docs/`.

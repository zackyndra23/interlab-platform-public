# Interlabs CRM — Documentation Design

**Date:** 2026-04-27
**Status:** Approved (Phase: design → ready for implementation plan)
**Owner:** zakyisputra (putra.zakyindras@gmail.com)

## Goal

Produce a complete, hand-written documentation set for the Interlabs CRM repo. Two distinct audiences, kept in separate trees:

1. **Solo + future-Claude** — the primary audience. Terse, dense, code-citing. Lives under `docs/runbook/`, `docs/backend/`, `docs/frontend/`.
2. **Stakeholder / compliance** — non-technical readers. Plain prose, no code. Lives under `docs/business/`. English only.

Per-module API/route reference goes as deep as the source allows: hand-written narrative covering routes, validators, services, DB tables, notifications fired, automations, and SLA hooks.

## Non-goals

- Auto-generation of any kind (no widdershins, no openapi-to-markdown, no JSDoc extraction). Hand-written prose only.
- UI screenshots (would rot every UI change).
- Diagrams as images (ASCII / Mermaid only — survives in plain markdown).
- A separate changelog (git log is the changelog).
- A separate CONTRIBUTING.md / CODE_OF_CONDUCT.md (solo project, not needed yet).

## Information architecture

```
README.md                                     ← root entry, doc map, quickstart
docs/
  runbook/                                    ← operator audience
    deployment.md                             ← compose stack, env, Traefik, first-boot
    database.md                               ← migration format, recovery, schema_migrations
    scheduler.md                              ← SCHEDULER_ENABLED leader-flag, runOnce, 4 jobs
    storage.md                                ← MinIO buckets, presigned URLs, file_attachments
    incidents.md                              ← common failures + recovery steps
  backend/                                    ← dev audience
    architecture.md                           ← app.js wiring, layered pattern, error envelope
    auth-and-rbac.md                          ← JWT, refresh, 3-layer RBAC, same-role constraint
    po-state-machine.md                       ← 11 stages, automations, audit trail
    notifications.md                          ← NotificationService, templates, email_queue
    websocket.md                              ← connect/auth/emit, event catalogue
    jobs.md                                   ← scheduler contract, overlap guard, runOnce
    modules/
      sales.md
      admin-log.md
      finance.md
      technical.md
      hrga.md
      tax.md
  frontend/                                   ← dev audience
    architecture.md                           ← App Router, AppShell, route conventions
    state-and-forms.md                        ← Zustand stores, react-hook-form patterns
    api-layer.md                              ← axios, lib/{module}-{api,types,ui}.ts trio
    rbac-and-nav.md                           ← navConfig, usePermission, gating layers
  business/                                   ← stakeholder audience, English only
    system-overview.md                        ← what it does, who uses it, glossary (canonical)
    roles-and-permissions.md                  ← 8 roles in business terms
    sla-policies.md                           ← all SLAs in plain language
    audit-and-compliance.md                   ← audit trail, RBAC layers, soft deletes
    data-handling.md                          ← MinIO privacy, retention, presigned URLs
```

27 files total: 1 `README.md` + 5 runbook + 6 backend root + 6 backend modules + 4 frontend + 5 business.

## Per-file content templates

Every file in a given audience tree follows the same TOC so they read consistently.

### `README.md`

- One-paragraph "what this is"
- Quickstart: `git clone` → repo-root `.env` → `docker compose -f docker-compose.demo.yml up -d --build`
- Repo layout: 4-line tree pointing at `backend/`, `frontend/`, `interlabs-crm-demo/docs/` (specs), `docs/` (runtime docs)
- **Doc map** — links to every file under `docs/` grouped by audience
- "Where to start" cheat sheet (`I want to deploy → runbook/deployment.md`, etc.)

### `docs/runbook/*.md`

Per file:
1. **Purpose**
2. **Prerequisites** (env, network, credentials)
3. **Step-by-step procedures** (copy-pasteable commands)
4. **Failure modes & recovery**
5. **Reference** (env vars / file paths / commands consulted)

No architectural prose — that lives in `docs/backend/`.

### `docs/backend/architecture.md`, `auth-and-rbac.md`, `notifications.md`, `websocket.md`, `jobs.md`

Per file:
1. **Mental model** (one paragraph)
2. **Wiring diagram** (ASCII or Mermaid sequence)
3. **Key files** with `file:line` references
4. **Invariants** (lifted from CLAUDE.md, expanded)
5. **Extension points** ("to add X, do Y")

### `docs/backend/po-state-machine.md`

The central technical piece. Approx 400 lines.

1. **Overview** — the 11 stages as a table: stage name · owning division · entry trigger · exit trigger · side effects (status_history + tracking_event + notification template + automations)
2. **Per-stage detail** — one short section per stage with the canonical service call
3. **Automations** — one section per automation (AWB → Shipped/Customs/Arrived; DO → Delivery; PR PO-Out → Production; BAST → Invoice draft; Invoice Customer → Invoice) with the field write that triggers it and the service call that performs it
4. **Audit-trail contract** — columns that must be set on every transition
5. **Extension recipe** — "how to add a new stage"

### `docs/backend/modules/{module}.md` (6 files, exhaustive — 300-500 lines each)

Fixed 11-section TOC for every module file:

1. **Purpose** — what the division does, in 3 sentences
2. **Forms / entities owned** — records this module CRUDs
3. **Routes** — table: `METHOD /api/path` · auth/RBAC requirements · validator · service entry point · `file:line`
4. **Validators** — Joi schemas, field-by-field with constraints
5. **Services** — public methods of `services/{module}.service.js` with parameters, side effects, DB tables written
6. **DB tables** — list with key columns, FKs, soft-delete behavior
7. **Notifications fired** — every `notification_templates.code` this module emits, with trigger condition and recipients
8. **Automations** — incoming (other modules trigger this one) + outgoing (this module triggers others)
9. **SLA hooks** — which scheduled jobs touch this module's data
10. **Frontend pages** — paths under `app/(app)/{module}/...` and the lib trio that backs them
11. **Cross-references** — links to other module docs that this module integrates with

### `docs/frontend/*.md`

Per file:
1. **Mental model** (one paragraph)
2. **File references** (`file:line`)
3. **Patterns** with short code snippets (≤15 lines, header-commented)
4. **Gotchas**

### `docs/business/*.md`

Plain prose, no code, no `file:line` refs. Tables only for the RBAC matrix and SLA list. Reading-time annotation at top (`~5 min read`). All Indonesian/domain terms link to the glossary in `system-overview.md`.

`system-overview.md` carries the **canonical glossary** — every domain term defined once: PO, PR, PR PO-Out, Quotation, HPP, BAST, AWB, DO, Masa Pajak, SPT, NPWP, BPJS, KEMNAKER, Domisili. Every other file (in any tree) bold-links first mentions to this glossary.

## Conventions

**Frontmatter on every file:**

```yaml
---
audience: dev | operator | stakeholder
reading_time: <N> min
last_reviewed: 2026-04-27
---
```

`audience` lets Claude filter what to load for a given task; `last_reviewed` flags staleness without git blame.

**Source-of-truth pointers, not duplication.** Dev/runbook claims about "the code does X" cite a `file:line` so the reader can jump to verify. The doc explains *why* and *how it fits*; the *what* lives in code. Business docs are prose-first, no code refs.

**Cross-link style.** Relative paths from the file itself, e.g. `[PO state machine](../po-state-machine.md#stage-3-production)`. README has the master doc map. No absolute URLs except for live deployment hosts.

**Code snippets.** Dev docs only. ≤15 lines each. Only when showing a pattern the reader needs to copy. Snippets carry a header comment like `// excerpt — backend/src/services/po.service.js` so it's clear they're not source of truth.

**Drift anchors.** Every file ends with an HTML comment listing the source files it mirrors:

```html
<!-- drift-anchors:
  backend/src/jobs/scheduler.js
  backend/migrations/013_sla_and_workflow.sql
-->
```

When those source files change in a future Claude session, the doc gets re-checked. Soft contract, not enforced.

**Domain terms.** First mention *per document* (not per section, not per repo) is bold-linked to the glossary entry in `docs/business/system-overview.md#glossary`. Subsequent mentions in the same document are plain text.

**RBAC notation.** Use canonical short codes from `interlabs-crm-demo/docs/CTX_master_context.txt` (e.g., `[Sales, Admin&Log, Finance]`) so Ctrl-F finds every role mention across the docs.

**File length cap.** Soft target ≤500 lines. If a file approaches that, it's a signal to split (e.g., `backend/modules/finance.md` may need to split into `finance-po.md` + `finance-invoice.md`). Implementation phase will flag rather than blow through silently.

## Generation order

27 files is too much for one session to do well. The implementation plan will batch these by phase, with a checkpoint at the end of each.

**Phase 0 — Prereqs (1 file).** `docs/business/system-overview.md` first — owns the glossary every other doc bold-links into.

**Phase 1 — Foundations (3 files).** Cited by every module doc.
1. `docs/backend/architecture.md`
2. `docs/backend/auth-and-rbac.md`
3. `docs/backend/po-state-machine.md`

**Phase 2 — Cross-cutting backend (3 files).** Notifications, WebSocket, jobs.
4. `docs/backend/notifications.md`
5. `docs/backend/websocket.md`
6. `docs/backend/jobs.md`

**Phase 3 — Per-module deep dives (6 files).** Cross-module automation pointers can be left as TODO refs and resolved in a single sweep at the end of phase 7.
7-12. `docs/backend/modules/{sales, admin-log, finance, technical, hrga, tax}.md`

**Phase 4 — Frontend (4 files).**
13. `docs/frontend/architecture.md`
14. `docs/frontend/state-and-forms.md`
15. `docs/frontend/api-layer.md`
16. `docs/frontend/rbac-and-nav.md`

**Phase 5 — Operator runbook (5 files).** Independent of dev docs but linked from them.
17. `docs/runbook/deployment.md`
18. `docs/runbook/database.md`
19. `docs/runbook/scheduler.md`
20. `docs/runbook/storage.md`
21. `docs/runbook/incidents.md`

**Phase 6 — Stakeholder (4 files).** Built last; references RBAC notation, SLA list, module purposes nailed down earlier.
22. `docs/business/roles-and-permissions.md`
23. `docs/business/sla-policies.md`
24. `docs/business/audit-and-compliance.md`
25. `docs/business/data-handling.md`

**Phase 7 — Wire-up.**
26. `README.md` — written last; needs every other path to exist.
27. **Cross-link sweep** — single pass over every file resolving cross-module TODO refs left during phase 3 and verifying anchors.

**Drift-anchor populate per file.** No file is "done" until its `<!-- drift-anchors -->` comment is set based on what the writing session actually read.

## Reading sources per file

Each phase reads from a specific subset of the codebase + spec. The implementation plan will list the exact files. Headline pairings:

| Doc file | Primary source files |
|---|---|
| `business/system-overview.md` | `interlabs-crm-demo/docs/CTX_master_context.txt`, `CTX_architecture.txt` |
| `backend/architecture.md` | `backend/src/app.js`, `middleware/*.js`, `utils/response.js`, `utils/errors.js` |
| `backend/auth-and-rbac.md` | `backend/src/services/auth.service.js`, `middleware/auth.middleware.js`, `middleware/rbac.middleware.js`, `migrations/001_users_and_sessions.sql`, `002_rbac.sql` |
| `backend/po-state-machine.md` | `backend/src/services/po.service.js`, `migrations/003_purchase_orders.sql`, `013_sla_and_workflow.sql`, `MOD_sales.txt`, `MOD_admin_log.txt`, `MOD_technical.txt`, `MOD_finance.txt` |
| `backend/notifications.md` | `services/notification.service.js`, `services/email.service.js`, `migrations/011_notifications_and_chat.sql`, `016_app_settings_and_email_queue.sql` |
| `backend/websocket.md` | `backend/src/websocket/*.js` |
| `backend/jobs.md` | `backend/src/jobs/*.js`, `utils/workingDays.js` |
| `backend/modules/sales.md` | `routes/sales.routes.js`, `services/sales.service.js`, `validators/sales.validators.js`, `migrations/005_sales_forms.sql`, `MOD_sales.txt` |
| `backend/modules/admin-log.md` | `routes/admin_log.routes.js`, `services/admin_log.service.js`, `validators/admin_log.validators.js`, `migrations/006_admin_log_forms.sql`, `MOD_admin_log.txt` |
| `backend/modules/finance.md` | `routes/finance.routes.js`, `services/finance.service.js`, `validators/finance.validators.js`, `migrations/007_finance_forms.sql`, `MOD_finance.txt` |
| `backend/modules/technical.md` | `routes/technical.routes.js`, `services/technical.service.js`, `validators/technical.validators.js`, `migrations/008_technical_forms.sql`, `MOD_technical.txt` |
| `backend/modules/hrga.md` | `routes/hrga.routes.js`, `services/hrga.service.js`, `validators/hrga.validators.js`, `migrations/009_hrga_forms.sql`, `MOD_hrga.txt` |
| `backend/modules/tax.md` | `routes/tax.routes.js`, `services/tax.service.js`, `validators/tax.validators.js`, `migrations/010_tax_insurance.sql`, `MOD_tax_insurance.txt` |
| `frontend/architecture.md` | `frontend/app/(app)/layout.tsx`, `components/layout/*.tsx`, `app/login/page.tsx` |
| `frontend/state-and-forms.md` | `frontend/stores/*.ts`, `hooks/*.ts`, `components/shared/RepeaterTable.tsx`, `MultiFileUpload.tsx`, `FormField.tsx` |
| `frontend/api-layer.md` | `frontend/lib/api.ts`, every `lib/{module}-api.ts`, `lib/auth.ts` |
| `frontend/rbac-and-nav.md` | `frontend/lib/rbac.ts`, `components/layout/navConfig.ts`, `hooks/usePermission.ts`, `components/layout/Sidebar.tsx` |
| `runbook/deployment.md` | `docker-compose.demo.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, repo-root `.env` (values redacted) |
| `runbook/database.md` | `backend/scripts/migrate.js`, `backend/scripts/wait-for-postgres.js`, every `migrations/*.sql` (read for shape) |
| `runbook/scheduler.md` | `backend/src/jobs/scheduler.js`, `backend/src/config/env.js` |
| `runbook/storage.md` | `backend/src/config/minio.js`, `services/file.service.js`, `migrations/012_file_attachments.sql` |
| `runbook/incidents.md` | All of the above (synthesized) |
| `business/roles-and-permissions.md` | `CTX_master_context.txt`, `migrations/002_rbac.sql`, `backend/scripts/seed.js` |
| `business/sla-policies.md` | `MOD_*.txt` (SLA sections), `backend/src/jobs/*.js` |
| `business/audit-and-compliance.md` | `CTX_master_context.txt`, `CTX_architecture.txt`, `migrations/015_activity_logs.sql` |
| `business/data-handling.md` | `CTX_architecture.txt` (MinIO section), `services/file.service.js`, `runbook/storage.md` |

## Open questions / deferred decisions

- **Indonesian-language version of `business/*.md`** deferred. User chose English-only for now; revisit if/when stakeholders need Bahasa Indonesia.
- **Generated reference (OpenAPI → HTML)** explicitly rejected for this round. Can be added later as a separate output that complements (not replaces) `backend/modules/*.md`.
- **Module file splits** (e.g., `finance.md` → `finance-po.md` + `finance-invoice.md`) decided per-file at write time based on the 500-line soft cap.

## Acceptance criteria

The documentation set is complete when:

1. All 27 files exist at the paths above.
2. Every file has the required frontmatter and a populated `<!-- drift-anchors -->` block.
3. Every domain term in `business/system-overview.md#glossary` is bold-linked from its first mention in every other file that uses it.
4. The `README.md` doc map links to every file under `docs/`.
5. No file exceeds 500 lines, or if it does, the implementation plan flagged it explicitly and the user approved the exception.
6. Spot check: pick three random `file:line` references from a backend doc and verify they resolve.

## Out of scope for this design

- The actual content of each file. That's the implementation plan's job.
- CI hooks to enforce drift-anchor freshness (could be added later as a separate task).
- A docs site (mkdocs/docusaurus). Markdown files in the repo are the deliverable.

## Next step

Hand off to `superpowers:writing-plans` to turn this design into a phased implementation plan.

<!-- drift-anchors:
  CLAUDE.md
  docker-compose.demo.yml
  backend/package.json
  frontend/package.json
  backend/src/app.js
  backend/src/jobs/scheduler.js
  backend/migrations/
  frontend/app/(app)/layout.tsx
  interlabs-crm-demo/docs/PIPELINE_README.txt
  interlabs-crm-demo/docs/CTX_master_context.txt
  interlabs-crm-demo/docs/CTX_architecture.txt
-->

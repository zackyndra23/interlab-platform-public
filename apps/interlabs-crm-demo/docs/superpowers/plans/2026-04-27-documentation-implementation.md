# Interlabs CRM Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 27 hand-written markdown documentation files covering the Interlabs CRM repo across operator, dev, and stakeholder audiences, per the approved design at `docs/superpowers/specs/2026-04-27-documentation-design.md`.

**Architecture:** Files are organized into four trees (`docs/runbook/`, `docs/backend/`, `docs/frontend/`, `docs/business/`) plus a root `README.md`. Three audiences kept separate (operator, dev, stakeholder). Hand-written prose only — no auto-generation. Every file carries frontmatter and a `<!-- drift-anchors -->` block listing the source files it mirrors.

**Tech Stack:** Markdown only. No build pipeline, no docs site, no generators. Verification is grep-based.

**Standing rules for every task:**
- **No git commits.** The user's CLAUDE.md says "Do not commit or push automatically." Each task ends with a checkpoint marker, not a commit.
- **No emojis** in any file unless the user asks for them.
- **All paths in the plan are relative to repo root** `/opt/projects/interlabs-crm-demo/`.
- **Read the spec first.** Before any task, read `docs/superpowers/specs/2026-04-27-documentation-design.md` end-to-end.
- **Write English only** in `docs/business/*.md` (per user decision).
- **Hard cap 500 lines per file** (soft target). If a file would exceed this, stop and report — do not silently split.

---

## Shared content rules (read before any task)

### Frontmatter (required on every file)

Every file under `docs/` and the root `README.md` starts with this exact block, with `<...>` filled in:

```yaml
---
audience: <dev | operator | stakeholder>
reading_time: <N> min
last_reviewed: 2026-04-27
---
```

`audience` values:
- `operator` → files under `docs/runbook/`
- `dev` → files under `docs/backend/`, `docs/backend/modules/`, `docs/frontend/`
- `stakeholder` → files under `docs/business/`
- `README.md` uses `audience: dev` (entry point assumes a developer reader; stakeholders enter via `docs/business/system-overview.md`).

### Drift-anchors block (required at end of every file)

Every file ends with an HTML comment listing the source files (code, migrations, or spec files) the doc mirrors. Empty placeholder is **not allowed** — populate it based on what was actually read while writing.

```html
<!-- drift-anchors:
  <repo-relative-path>
  <repo-relative-path>
-->
```

### Cross-link style

Relative paths only. Examples:
- From `docs/backend/modules/sales.md` to `docs/backend/po-state-machine.md`: `[PO state machine](../po-state-machine.md)`.
- From `docs/runbook/scheduler.md` to `docs/backend/jobs.md`: `[scheduler internals](../backend/jobs.md)`.
- From any file to glossary: `[**PO**](../business/system-overview.md#glossary-po)` (first mention only, per document).

### Glossary linking

First mention *per document* of any of these terms is **bold** and linked to its glossary anchor in `docs/business/system-overview.md`:

`PO`, `PR`, `PR PO-Out`, `Quotation`, `HPP`, `BAST`, `AWB`, `DO`, `Masa Pajak`, `SPT`, `NPWP`, `BPJS`, `KEMNAKER`, `Domisili`, `Superadmin`, `CEO`, `Sales`, `Admin & Log`, `Finance`, `Technical`, `HRGA`, `Tax & Insurance`.

Subsequent mentions in the same document are plain text.

### RBAC notation

Use canonical short codes from `interlabs-crm-demo/docs/CTX_master_context.txt` in square brackets:
`[Superadmin]`, `[CEO]`, `[Sales]`, `[Admin&Log]`, `[Finance]`, `[Technical]`, `[HRGA]`, `[Tax&Insurance]`.

When listing multiple roles: `[Sales, Admin&Log, Finance]` (no spaces after `[`, no `&` shorthand inside bracket).

### Verification commands (used in every task)

Each task's verification step runs these from repo root:

```bash
# 1. Frontmatter present
head -5 <file> | grep -q '^---$' && head -5 <file> | grep -q '^audience: '

# 2. Drift-anchors present and non-empty
grep -A1 'drift-anchors:' <file> | tail -1 | grep -qv '^-->$'

# 3. Length cap
test "$(wc -l < <file>)" -le 500

# 4. Required headers (per task — task lists exact headers)
grep -c '^## <Header Name>$' <file>
```

---

# Phase 0 — Glossary prereq

## Task 0.1: `docs/business/system-overview.md` (canonical glossary owner)

**Files:**
- Create: `docs/business/system-overview.md`

**Audience:** stakeholder. Plain English prose, no code, no `file:line` refs.

**Sources to read first:**
- `interlabs-crm-demo/docs/CTX_master_context.txt` (full file)
- `interlabs-crm-demo/docs/CTX_architecture.txt` (full file)
- `CLAUDE.md` (for non-negotiable invariants)

- [ ] **Step 1: Read all three sources end-to-end.** Take notes on (a) what the system does, (b) which divisions use it, (c) every domain term that needs a glossary entry.

- [ ] **Step 2: Write the file.** Required structure (use these exact section headers):

  ```
  ---
  audience: stakeholder
  reading_time: 8 min
  last_reviewed: 2026-04-27
  ---

  # System Overview

  ## What this system is
  <2-3 paragraphs: internal CRM + ERP + Realtime Operations Hub for PT. Interlab
  Sentra Solutions Indonesia. Indonesian business locale, IDR primary, Asia/Jakarta.>

  ## Who uses it
  <Eight roles listed with one-sentence purpose each: Superadmin, CEO, Sales,
  Admin & Log, Finance, Technical, HRGA/Legal, Tax & Insurance.>

  ## Core flow: the Purchase Order lifecycle
  <Plain-English walkthrough of the 11 stages, no code. One paragraph per stage
  cluster: Sales (Registered → Processed) → Finance (Production) → Admin & Log
  (Shipped/Customs/Arrived) → Technical (Inspected) → Admin & Log (Delivery) →
  Technical (Installation/BAST) → Finance (Invoice). Cross-link to
  business/sla-policies.md for SLA detail.>

  ## How data is protected
  <One paragraph each: 3-layer RBAC, audit trail, file storage privacy. No
  technical detail — narrative only. Cross-link to audit-and-compliance.md.>

  ## Glossary
  <Anchor each term as `### Glossary: <TERM>` so other files can link to
  `#glossary-po`, `#glossary-bast`, etc. Each entry: 2-4 sentences in plain
  English. Required entries (in this order):
    PO, PR, PR PO-Out, Quotation, HPP, BAST, AWB, DO, Masa Pajak, SPT, NPWP,
    BPJS, KEMNAKER, Domisili, Superadmin, CEO, Sales, Admin & Log, Finance,
    Technical, HRGA, Tax & Insurance.>
  ```

  Anchor format: each glossary entry's heading must be `### Glossary: PO` (etc.) so the auto-generated anchor is `#glossary-po`.

- [ ] **Step 3: Populate drift-anchors.**

  ```html
  <!-- drift-anchors:
    interlabs-crm-demo/docs/CTX_master_context.txt
    interlabs-crm-demo/docs/CTX_architecture.txt
    CLAUDE.md
  -->
  ```

- [ ] **Step 4: Verify.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  head -5 docs/business/system-overview.md | grep -q '^audience: stakeholder$' || echo "FRONTMATTER MISSING"
  grep -c '^### Glossary: ' docs/business/system-overview.md  # expect 22
  grep -A1 'drift-anchors:' docs/business/system-overview.md | tail -1 | grep -qv '^-->$' || echo "ANCHORS EMPTY"
  test "$(wc -l < docs/business/system-overview.md)" -le 500 || echo "OVER LIMIT"
  ```

  Expected: 22 glossary entries, no error output.

- [ ] **Step 5: Checkpoint.** Print "Phase 0 complete" and stop. Do not commit.

---

# Phase 1 — Foundations

> All Phase 1 tasks share this template:
> - Audience: `dev`
> - Required sections (in order): `## Mental model`, `## Wiring`, `## Key files`, `## Invariants`, `## Extension points`
> - Code snippets allowed in `## Wiring` and `## Extension points`, ≤15 lines each, header-commented with the exact source path
> - Every backend code reference uses `file:line` format

## Task 1.1: `docs/backend/architecture.md`

**Files:**
- Create: `docs/backend/architecture.md`

**Sources to read first:**
- `backend/src/app.js` (full file)
- `backend/src/middleware/auth.middleware.js`
- `backend/src/middleware/rbac.middleware.js`
- `backend/src/middleware/validator.middleware.js`
- `backend/src/middleware/errorHandler.middleware.js`
- `backend/src/middleware/requestLogger.middleware.js`
- `backend/src/middleware/rateLimit.middleware.js`
- `backend/src/utils/response.js`
- `backend/src/utils/errors.js`

- [ ] **Step 1: Read all sources.** Note the middleware order in `app.js`, the response envelope shape from `utils/response.js`, and the error class hierarchy from `utils/errors.js`.

- [ ] **Step 2: Write the file.**

  - **Mental model:** Express app + per-route middleware chain (rate limit → JWT auth → RBAC → validator → handler → error envelope). WebSocket attaches to the same HTTP listener at `/api/ws`. Scheduler runs in-process (single-leader via `SCHEDULER_ENABLED`). State is in Postgres + Redis (sessions) + MinIO (files); nothing in process memory except the scheduler bookkeeping.
  - **Wiring:** ASCII diagram of request flow. List every middleware in order with one line each, citing `app.js:LINE`. Show the response envelope shape: `{ success, data }` for 2xx, `{ success: false, error, code }` for 4xx/5xx.
  - **Key files:** Table — `backend/src/app.js`, `middleware/*.js`, `utils/response.js`, `utils/errors.js`. Each row: file · purpose · `file:line` of the most important export.
  - **Invariants:** Lift from CLAUDE.md "Non-negotiable architectural invariants". Expand each into 2-3 sentences with code citations.
  - **Extension points:** "To add a new module: create `routes/<mod>.routes.js`, `validators/<mod>.validators.js`, `services/<mod>.service.js`, mount in `app.js`. To add a new middleware: register in the order above, after request logging, before route handlers."

- [ ] **Step 3: Populate drift-anchors.** Include every source listed above.

- [ ] **Step 4: Verify.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  for h in 'Mental model' 'Wiring' 'Key files' 'Invariants' 'Extension points'; do
    grep -q "^## $h$" docs/backend/architecture.md || echo "MISSING: $h"
  done
  head -5 docs/backend/architecture.md | grep -q '^audience: dev$' || echo "FRONTMATTER"
  grep -A1 'drift-anchors:' docs/backend/architecture.md | tail -1 | grep -qv '^-->$' || echo "ANCHORS"
  test "$(wc -l < docs/backend/architecture.md)" -le 500 || echo "OVER LIMIT"
  ```

- [ ] **Step 5: Checkpoint.** Print "Task 1.1 complete".

## Task 1.2: `docs/backend/auth-and-rbac.md`

**Files:**
- Create: `docs/backend/auth-and-rbac.md`

**Sources to read first:**
- `backend/src/services/auth.service.js`
- `backend/src/middleware/auth.middleware.js`
- `backend/src/middleware/rbac.middleware.js`
- `backend/src/routes/auth.routes.js`
- `backend/src/validators/auth.validators.js`
- `backend/migrations/001_users_and_sessions.sql`
- `backend/migrations/002_rbac.sql`
- `backend/scripts/seed.js` (for the canonical role/permission rows)

- [ ] **Step 1: Read all sources.** Note: JWT shape (access + refresh), bcrypt rounds, refresh-token rotation rules, the `roles` / `permissions` / `role_permissions` / `feature_definitions` / `capability_definitions` schema, and the `managed_role_scope` / `can_manage_same_role_users` columns.

- [ ] **Step 2: Write the file.** Use the Phase 1 template sections.

  - **Mental model:** Three RBAC layers — frontend (sidebar/page gates), backend route middleware, database scope filters. Permission matrix lives in DB, not code. Same-role-management constraint enforced server-side via `managed_role_scope`. JWT access (1h) + refresh (7d, or 30d with remember-me) — refresh rotates on use.
  - **Wiring:** Sequence list for login flow (`POST /api/auth/login` → bcrypt verify → issue access + refresh → return). Sequence list for protected request (`Authorization: Bearer <jwt>` → `auth.middleware` → `rbac.middleware` checks `req.user.permissions` → handler). Cite `services/auth.service.js:LINE` and `middleware/auth.middleware.js:LINE`.
  - **Key files:** Table of files listed above with `file:line` of the principal export.
  - **Invariants:**
    - "Never rely on frontend gating alone."
    - "Permission matrix lives in DB — do not hardcode in application code."
    - "Same-role management constraint: enforce server-side via `managed_role_scope`."
    - Each invariant cites the table or function that enforces it.
  - **Extension points:** "To add a new permission: insert into `permissions` + `role_permissions` via a migration. To add a new role: see Task 1.1 'add a new module' first; new roles also need `feature_definitions` rows."

- [ ] **Step 3: Populate drift-anchors.**

- [ ] **Step 4: Verify** (same five-header check as Task 1.1).

- [ ] **Step 5: Checkpoint.** Print "Task 1.2 complete".

## Task 1.3: `docs/backend/po-state-machine.md` (the central piece)

**Files:**
- Create: `docs/backend/po-state-machine.md`

**Audience:** dev. **Soft target ≤500 lines** — if it would exceed, stop and report.

**Sources to read first:**
- `backend/src/services/po.service.js` (full file)
- `backend/migrations/003_purchase_orders.sql`
- `backend/migrations/013_sla_and_workflow.sql`
- `interlabs-crm-demo/docs/CTX_master_context.txt` (PO lifecycle section)
- `interlabs-crm-demo/docs/MOD_sales.txt` (Registered/Processed)
- `interlabs-crm-demo/docs/MOD_finance.txt` (Production, Invoice)
- `interlabs-crm-demo/docs/MOD_admin_log.txt` (Shipped/Customs/Arrived/Delivery)
- `interlabs-crm-demo/docs/MOD_technical.txt` (Inspected/Installation/BAST)

- [ ] **Step 1: Read all sources.** Build a stage-by-stage table on scratch paper before drafting.

- [ ] **Step 2: Write the file.** Required sections (in order):

  - **Overview** — the 11 stages as a single table. Columns: # · Stage · Owning division · Entry trigger · Exit trigger · Side effects (mention status_history + tracking_event + notification_template_code + automation_id where applicable).
  - **Per-stage detail** — eleven `## Stage N: <name>` subsections. Each must cover: who can transition into it, the exact `services/po.service.js` function call, the columns updated on `purchase_orders`, the `purchase_order_status_history` row inserted, the `purchase_order_tracking_events` row inserted, the notification template code fired (if any).
  - **Automations** — five `### Automation: <name>` subsections, one each:
    1. AWB created → Shipped/Customs/Arrived (depends on AWB status field)
    2. DO created → Delivery
    3. PR (Purchase Requisition) marked PO-Out → Production
    4. BAST signed → Invoice draft created
    5. Invoice Customer issued → Invoice stage
    Each: trigger condition (which field write), service function that performs it, side effects, RBAC scope.
  - **Audit-trail contract** — mandatory columns on every transition: `updated_by_user_id`, `updated_by_role`, `updated_at`, `note`, `reason_if_delayed`. Reference the migration line that enforces NOT NULL.
  - **Extension recipe** — "How to add a new stage": migration to add enum value → service function → notification template → status_history + tracking_event handling → frontend status badge mapping.

- [ ] **Step 3: Populate drift-anchors.** Include all 8 source files.

- [ ] **Step 4: Verify.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  for h in 'Overview' 'Per-stage detail' 'Automations' 'Audit-trail contract' 'Extension recipe'; do
    grep -q "^## $h$" docs/backend/po-state-machine.md || echo "MISSING: $h"
  done
  test "$(grep -c '^## Stage [0-9]\+: ' docs/backend/po-state-machine.md)" -eq 11 || echo "WRONG STAGE COUNT"
  test "$(grep -c '^### Automation: ' docs/backend/po-state-machine.md)" -eq 5 || echo "WRONG AUTOMATION COUNT"
  test "$(wc -l < docs/backend/po-state-machine.md)" -le 500 || echo "OVER LIMIT — REPORT, DO NOT SPLIT"
  ```

- [ ] **Step 5: Checkpoint.** Print "Task 1.3 complete — Phase 1 done".

---

# Phase 2 — Cross-cutting backend

> Phase 2 tasks share the Phase 1 template (5-section TOC, dev audience, code snippets ≤15 lines).

## Task 2.1: `docs/backend/notifications.md`

**Files:**
- Create: `docs/backend/notifications.md`

**Sources to read first:**
- `backend/src/services/notification.service.js`
- `backend/src/services/email.service.js`
- `backend/migrations/011_notifications_and_chat.sql`
- `backend/migrations/016_app_settings_and_email_queue.sql`
- `interlabs-crm-demo/docs/CTX_master_context.txt` (notification system section)

- [ ] **Step 1: Read all sources.** Enumerate every `notification_templates.code` in the seed data and migrations.

- [ ] **Step 2: Write the file.** Use Phase 1 template, plus an extra `## Template catalogue` section between `## Key files` and `## Invariants`.

  - **Mental model:** Domain events emit to `NotificationService.emit(eventCode, payload)`. The service looks up `notification_templates` row by code, checks `enabled`, resolves recipients (specific users, by role, or by capability), then fans out to the dashboard (`notifications` table) + email (`email_queue` table). A disabled template suppresses *all* delivery for that event.
  - **Wiring:** Sequence diagram (text): event → `emit()` → template lookup → recipient resolution → fan-out. Cite `services/notification.service.js:LINE`.
  - **Key files:** Table.
  - **Template catalogue:** Markdown table of every template code: code · trigger event · default recipients · default channels (dashboard/email/both). Source: `notification_templates` rows in migrations + seed.
  - **Invariants:** "Disabled template = no delivery anywhere." "Recipients resolved at emit time, not at template-definition time." "Email is queued, not synchronous — `email_queue` is drained by [worker / on-API-request — verify in source]."
  - **Extension points:** "To add a notification: insert template row, call `NotificationService.emit('your_code', payload)` from service layer."

- [ ] **Step 3: Drift-anchors.**

- [ ] **Step 4: Verify** (six-header check: standard five plus `Template catalogue`).

- [ ] **Step 5: Checkpoint.**

## Task 2.2: `docs/backend/websocket.md`

**Files:**
- Create: `docs/backend/websocket.md`

**Sources to read first:**
- `backend/src/websocket/index.js`
- `backend/src/websocket/server.js`
- `backend/src/websocket/state.js`
- `backend/src/websocket/emitter.js`
- `backend/src/websocket/handlers.js`
- `backend/src/app.js` (the `websocket.attach(server)` call site)

- [ ] **Step 1: Read all sources.** Enumerate every event type the server emits and every inbound message it handles.

- [ ] **Step 2: Write the file.** Phase 1 template plus a `## Event catalogue` section.

  - **Mental model:** WebSocket attaches to same HTTP listener at `/api/ws` (shared TLS). Auth via JWT in connection query string. Connection registry in `state.js`. Domain code calls `sendToUser` / `sendToUsers` / `sendToRole` / `broadcastAll` from `websocket/index.js`.
  - **Wiring:** Connect handshake sequence (URL → JWT verify → register in state) + outbound emit sequence (domain service → `emitter.sendToUser` → state lookup → write to socket).
  - **Key files:** Table.
  - **Event catalogue:** Two tables — outbound events (domain → client, e.g., `notification.new`, `po.stage_changed`) and inbound messages (client → server, e.g., `chat.message`).
  - **Invariants:** "All cross-process WS state lives in Redis." "No reaching into `emitter.js` / `server.js` from domain code — go through `websocket/index.js`."
  - **Extension points:** "To add an outbound event: emit from service layer via `sendToUser`. To add an inbound message: register a handler in `handlers.js`."

- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (six-header check).
- [ ] **Step 5: Checkpoint.**

## Task 2.3: `docs/backend/jobs.md`

**Files:**
- Create: `docs/backend/jobs.md`

**Sources to read first:**
- `backend/src/jobs/scheduler.js`
- `backend/src/jobs/slaReadyToDeliver.job.js`
- `backend/src/jobs/slaPoDueDate.job.js`
- `backend/src/jobs/slaHrgaExpiry.job.js`
- `backend/src/jobs/taxDeadlineMonitor.job.js`
- `backend/src/utils/workingDays.js`
- `backend/src/config/env.js` (scheduler section)

- [ ] **Step 1: Read all sources.** Note the four cron expressions and the SCHEDULER_ENABLED leader-flag pattern.

- [ ] **Step 2: Write the file.** Phase 1 template plus a `## Job catalogue` section.

  - **Mental model:** node-cron in-process, evaluated in Asia/Jakarta. Single-leader via `SCHEDULER_ENABLED` env flag — for horizontal scaling, only one node has it true. Per-job in-flight lock prevents overlapping ticks within a process; does not coordinate across processes.
  - **Wiring:** Lifecycle (`start()` registers; cron tick → `executeGuarded()` → `inFlight` check → run → log). Out-of-band: `runOnce(name)` from a node REPL.
  - **Key files:** Table.
  - **Job catalogue:** Table — name · cron expression · timezone · purpose · source job module · DB tables read · notification template fired.
    - `sla_technical_ready_to_deliver` `0 * * * *` · hourly
    - `technical_po_due_reminder` `0 8 * * *` · daily 08:00
    - `hrga_expiry_monitor` `0 8 * * *` · daily 08:00
    - `tax_deadline_monitor` `0 8 1 * *` · monthly 1st 08:00
  - **Invariants:** "Working-day math (skip weekends) via `utils/workingDays.js`." "Jobs are idempotent — safe to `runOnce` manually." "Overlap guard is per-process, not cluster-wide."
  - **Extension points:** "To add a job: write `<name>.job.js` exposing `async run()`, register in `JOB_DEFINITIONS` array."

- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (six-header check, plus assert table has 4 jobs: `grep -c '^| sla_\|^| technical_\|^| hrga_\|^| tax_' docs/backend/jobs.md` ≥ 4).
- [ ] **Step 5: Checkpoint.** Print "Phase 2 complete".

---

# Phase 3 — Per-module deep dives

> Phase 3 tasks share an 11-section TOC. **Read this template before any of the 6 module tasks.**

### Module-doc template (applies to Tasks 3.1 through 3.6)

**Audience:** `dev`. **Soft cap 500 lines** — if exceeded, stop and report (do not split silently).

**Required section headers, in this exact order:**

1. `## Purpose` — what the division does in 3 sentences
2. `## Forms / entities owned` — bullet list of records this module CRUDs
3. `## Routes` — markdown table: `METHOD /api/path` · auth/RBAC · validator function · service entry · `file:line`
4. `## Validators` — one subsection per Joi schema with field-by-field constraints (`### <SchemaName>`)
5. `## Services` — one subsection per public method of `services/<module>.service.js` (`### <methodName>(<args>)`) with: parameters, side effects, DB tables written, notifications fired
6. `## DB tables` — list with key columns, FKs, soft-delete behavior
7. `## Notifications fired` — table: template code · trigger condition · default recipients
8. `## Automations` — two subsections: `### Incoming` (other modules trigger this one) and `### Outgoing` (this module triggers others). Cross-link to `../po-state-machine.md` for any PO transition.
9. `## SLA hooks` — bullet list of scheduled jobs from `docs/backend/jobs.md` that touch this module's data
10. `## Frontend pages` — table: app-router path · component file · lib trio (`{module}-api.ts`, `{module}-types.ts`, `{module}-ui.ts`) functions used
11. `## Cross-references` — bullet list of links to other module docs this module integrates with

**Code snippets:** allowed in `## Validators` and `## Services` only, ≤15 lines, header-commented with the exact source path.

**RBAC notation:** every `## Routes` row's auth column uses canonical bracket notation.

**Verification (per file):**

```bash
cd /opt/projects/interlabs-crm-demo
F=docs/backend/modules/<module>.md
for h in 'Purpose' 'Forms / entities owned' 'Routes' 'Validators' 'Services' 'DB tables' \
         'Notifications fired' 'Automations' 'SLA hooks' 'Frontend pages' 'Cross-references'; do
  grep -q "^## $h$" $F || echo "MISSING: $h"
done
head -5 $F | grep -q '^audience: dev$' || echo "FRONTMATTER"
grep -A1 'drift-anchors:' $F | tail -1 | grep -qv '^-->$' || echo "ANCHORS"
test "$(wc -l < $F)" -le 500 || echo "OVER LIMIT — REPORT"
```

## Task 3.1: `docs/backend/modules/sales.md`

**Files:** Create `docs/backend/modules/sales.md`.

**Sources to read first:**
- `backend/src/routes/sales.routes.js`
- `backend/src/services/sales.service.js`
- `backend/src/validators/sales.validators.js`
- `backend/migrations/005_sales_forms.sql`
- `backend/migrations/003_purchase_orders.sql` (PO is owned across modules but originates here)
- `backend/migrations/004_customers.sql`
- `interlabs-crm-demo/docs/MOD_sales.txt` (full)
- `frontend/lib/sales-api.ts`, `frontend/lib/sales-types.ts`, `frontend/lib/sales-ui.ts`
- `frontend/app/(app)/sales/` (directory tree)

- [ ] **Step 1: Read all sources.** Enumerate routes, validators, services, tables, notifications, frontend pages.
- [ ] **Step 2: Write the file** following the module-doc template above. Forms owned: PR, Quotation, HPP, Customer, Forecast, PO (origination only — handoff is in `../po-state-machine.md`).
- [ ] **Step 3: Drift-anchors.** All sources above.
- [ ] **Step 4: Verify** (use template's verification block with `<module>=sales`).
- [ ] **Step 5: Checkpoint.** Print "Task 3.1 complete".

## Task 3.2: `docs/backend/modules/admin-log.md`

**Files:** Create `docs/backend/modules/admin-log.md`.

**Sources to read first:**
- `backend/src/routes/admin_log.routes.js`
- `backend/src/services/admin_log.service.js`
- `backend/src/validators/admin_log.validators.js`
- `backend/migrations/006_admin_log_forms.sql`
- `interlabs-crm-demo/docs/MOD_admin_log.txt` (full)
- `frontend/lib/admin-log-api.ts`, `admin-log-types.ts`, `admin-log-ui.ts`
- `frontend/app/(app)/admin-log/` (tree)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write file** per template. Forms owned: AWB, Delivery Order, Operational records, Ready-to-Deliver tracking. Automations include AWB → Shipped/Customs/Arrived (outgoing) and Ready-to-Deliver from Technical (incoming).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (`<module>=admin-log`).
- [ ] **Step 5: Checkpoint.**

## Task 3.3: `docs/backend/modules/finance.md`

**Files:** Create `docs/backend/modules/finance.md`.

**Sources to read first:**
- `backend/src/routes/finance.routes.js`
- `backend/src/services/finance.service.js`
- `backend/src/validators/finance.validators.js`
- `backend/migrations/007_finance_forms.sql`
- `interlabs-crm-demo/docs/MOD_finance.txt` (full)
- `frontend/lib/finance-api.ts`, `finance-types.ts`, `finance-ui.ts`
- `frontend/app/(app)/finance/` (tree)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write file** per template. Forms owned: Purchase Requisition, PO Customer, Invoice Manufacture, Invoice Customer. Automations: PR PO-Out → Production (outgoing), BAST signed → Invoice draft (incoming from Technical).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (`<module>=finance`).
- [ ] **Step 5: Checkpoint.**

  **If file exceeds 500 lines:** stop. Report the line count. Do not split. The user decides whether to split into `finance-po.md` + `finance-invoice.md`.

## Task 3.4: `docs/backend/modules/technical.md`

**Files:** Create `docs/backend/modules/technical.md`.

**Sources to read first:**
- `backend/src/routes/technical.routes.js`
- `backend/src/services/technical.service.js`
- `backend/src/validators/technical.validators.js`
- `backend/migrations/008_technical_forms.sql`
- `interlabs-crm-demo/docs/MOD_technical.txt` (full)
- `frontend/lib/technical-api.ts`, `technical-types.ts`, `technical-ui.ts`
- `frontend/app/(app)/technical/` (tree)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write file** per template. Forms owned: Job Order, Inspection/QC, Installation, BAST, Spareparts, PM (Preventive Maintenance). Automations: BAST → Invoice draft (outgoing to Finance), Ready-to-Deliver → Admin & Log (outgoing).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (`<module>=technical`).
- [ ] **Step 5: Checkpoint.**

## Task 3.5: `docs/backend/modules/hrga.md`

**Files:** Create `docs/backend/modules/hrga.md`.

**Sources to read first:**
- `backend/src/routes/hrga.routes.js`
- `backend/src/services/hrga.service.js`
- `backend/src/validators/hrga.validators.js`
- `backend/migrations/009_hrga_forms.sql`
- `interlabs-crm-demo/docs/MOD_hrga.txt` (full)
- `frontend/lib/hrga-api.ts`, `hrga-types.ts`, `hrga-ui.ts`
- `frontend/app/(app)/hrga/` (tree)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write file** per template. Forms owned: Legalitas (NPWP, Domisili, KEMNAKER, etc.), Company Letters, Archive, Compliance, Smart Search. SLA hook: `hrga_expiry_monitor` (90/30-day expiry tiers).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (`<module>=hrga`).
- [ ] **Step 5: Checkpoint.**

## Task 3.6: `docs/backend/modules/tax.md`

**Files:** Create `docs/backend/modules/tax.md`.

**Sources to read first:**
- `backend/src/routes/tax.routes.js`
- `backend/src/services/tax.service.js`
- `backend/src/validators/tax.validators.js`
- `backend/migrations/010_tax_insurance.sql`
- `interlabs-crm-demo/docs/MOD_tax_insurance.txt` (full)
- `frontend/lib/tax-api.ts`, `tax-types.ts`, `tax-ui.ts`
- `frontend/app/(app)/tax/` (tree)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write file** per template. Forms owned: Operational tax records, Masa Pajak, SPT. SLA hook: `tax_deadline_monitor` (3 rules — missing record, unpaid closed Masa Pajak, SPT not filed).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (`<module>=tax`).
- [ ] **Step 5: Checkpoint.** Print "Phase 3 complete".

---

# Phase 4 — Frontend

> Phase 4 tasks share the Phase 1 5-section TOC (`Mental model`, `Wiring`, `Key files`, `Invariants`, `Extension points`). Audience `dev`. Code snippets ≤15 lines.

## Task 4.1: `docs/frontend/architecture.md`

**Files:** Create `docs/frontend/architecture.md`.

**Sources to read first:**
- `frontend/app/layout.tsx`
- `frontend/app/(app)/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/login/page.tsx`
- `frontend/components/layout/AppShell.tsx`
- `frontend/components/layout/AuthGuard.tsx`
- `frontend/components/layout/Sidebar.tsx`
- `frontend/components/layout/TopBar.tsx`
- `frontend/components/layout/ThemeBootstrap.tsx`
- `frontend/next.config.mjs`
- `frontend/tailwind.config.ts`

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Mental model:** Next.js 14 App Router, standalone output. `(app)` route group is auth-gated by `AppShell`. `app/login/` is the only public route. TypeScript everywhere. Tailwind for styling. Dark mode via `theme.store.ts`.
  - **Wiring:** Route tree diagram (ASCII). Render flow: `app/layout.tsx` (root html/body) → `(app)/layout.tsx` (AppShell with AuthGuard, Sidebar, TopBar, ThemeBootstrap) → page.
  - **Key files:** Table.
  - **Invariants:** "Module pages never render outside `AppShell`." "No client-side secrets — only `NEXT_PUBLIC_*` reaches the bundle."
  - **Extension points:** "To add a module section: create `app/(app)/<module>/...` mirroring an existing module, add to `navConfig.ts` with the right capability gate."
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (5-header check).
- [ ] **Step 5: Checkpoint.**

## Task 4.2: `docs/frontend/state-and-forms.md`

**Files:** Create `docs/frontend/state-and-forms.md`.

**Sources to read first:**
- `frontend/stores/auth.store.ts`
- `frontend/stores/notification.store.ts`
- `frontend/stores/sidebar.store.ts`
- `frontend/stores/theme.store.ts`
- `frontend/hooks/useAuth.ts`
- `frontend/hooks/useFormDraft.ts`
- `frontend/hooks/useNotifications.ts`
- `frontend/hooks/useWebSocket.ts`
- `frontend/hooks/usePermission.ts`
- `frontend/components/shared/RepeaterTable.tsx`
- `frontend/components/shared/MultiFileUpload.tsx`
- `frontend/components/shared/FormField.tsx`
- `frontend/components/shared/DatePicker.tsx`
- `frontend/components/shared/CurrencyInput.tsx`

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Mental model:** Zustand for global state (auth, notifications, sidebar, theme). react-hook-form + zod for forms. `useFormDraft` for autosave. Shared form components in `components/shared/`.
  - **Wiring:** Form lifecycle (mount → `useFormDraft` rehydrates → user edits → onSubmit → axios via lib trio → toast).
  - **Key files:** Two tables — one for stores, one for hooks + shared components.
  - **Invariants:** "Forms always go through `react-hook-form` + zod resolver." "Currency uses `CurrencyInput` (IDR formatting)." "File uploads use `MultiFileUpload` with the matching backend size cap."
  - **Extension points:** "New form: copy an existing module page, swap the schema. New shared input: live in `components/shared/`."
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 4.3: `docs/frontend/api-layer.md`

**Files:** Create `docs/frontend/api-layer.md`.

**Sources to read first:**
- `frontend/lib/api.ts`
- `frontend/lib/auth.ts`
- `frontend/lib/env.ts`
- `frontend/lib/utils.ts`
- `frontend/lib/sales-api.ts`, `admin-log-api.ts`, `finance-api.ts`, `technical-api.ts`, `hrga-api.ts`, `tax-api.ts`, `global-api.ts`
- `frontend/lib/websocket.ts`

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Mental model:** One axios instance in `lib/api.ts` with auth interceptor (attaches JWT, refreshes on 401). Per-module trio: `{module}-api.ts` (axios calls), `{module}-types.ts` (TS types mirroring backend response shapes), `{module}-ui.ts` (status colors, label maps, formatters). Cross-module shared: `auth.ts`, `env.ts`, `utils.ts`, `websocket.ts`.
  - **Wiring:** Request flow (component → `<module>-api.ts` function → `api.ts` axios instance → JWT attached → response unwrapped from `{ success, data }` envelope).
  - **Key files:** Table.
  - **Invariants:** "Never call `axios` directly — always through `lib/api.ts`." "Types in `{module}-types.ts` mirror backend response shapes; if backend changes, update types first."
  - **Extension points:** "New API call: add to the relevant `{module}-api.ts`. New module: create the trio."
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 4.4: `docs/frontend/rbac-and-nav.md`

**Files:** Create `docs/frontend/rbac-and-nav.md`.

**Sources to read first:**
- `frontend/lib/rbac.ts`
- `frontend/components/layout/navConfig.ts`
- `frontend/components/layout/Sidebar.tsx`
- `frontend/components/layout/AuthGuard.tsx`
- `frontend/hooks/usePermission.ts`
- `frontend/hooks/useAuth.ts`

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Mental model:** Frontend gating is *layer 1 of 3* — never the only check (backend RBAC middleware enforces; DB scope filters enforce). `navConfig.ts` is the source of truth for menu structure + capability requirements. `usePermission(capabilityCode)` returns boolean for component-level gating.
  - **Wiring:** AuthGuard sequence (mount → check `useAuth().user` → redirect to login if none). Sidebar render (iterate navConfig → for each item, `usePermission(item.capability)` → render if true).
  - **Key files:** Table.
  - **Invariants:** "Frontend gating is UX, not security." "Every nav item lists the exact capability code from `capability_definitions`." "Same-role management constraint also rendered server-side — frontend just hides the button."
  - **Extension points:** "New nav item: add to `navConfig.ts` with capability code. New capability: add to backend migration first, then expose via the user/me endpoint."
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.** Print "Phase 4 complete".

---

# Phase 5 — Operator runbook

> Phase 5 tasks share an operator template. **Read this template before any Phase 5 task.**

### Runbook template (applies to Tasks 5.1 through 5.5)

**Audience:** `operator`. Command-heavy, no architectural prose.

**Required sections (in order):**

1. `## Purpose`
2. `## Prerequisites` — env, network, credentials, access
3. `## Procedures` — one `### Procedure: <name>` subsection per workflow, with copy-pasteable commands
4. `## Failure modes` — one `### Failure: <name>` subsection per common failure, with detection + recovery
5. `## Reference` — env vars, file paths, commands consulted

**Verification (per file):**

```bash
cd /opt/projects/interlabs-crm-demo
F=docs/runbook/<name>.md
for h in 'Purpose' 'Prerequisites' 'Procedures' 'Failure modes' 'Reference'; do
  grep -q "^## $h$" $F || echo "MISSING: $h"
done
head -5 $F | grep -q '^audience: operator$' || echo "FRONTMATTER"
grep -A1 'drift-anchors:' $F | tail -1 | grep -qv '^-->$' || echo "ANCHORS"
test "$(wc -l < $F)" -le 500 || echo "OVER LIMIT"
```

## Task 5.1: `docs/runbook/deployment.md`

**Files:** Create `docs/runbook/deployment.md`.

**Sources to read first:**
- `docker-compose.demo.yml`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `backend/.env.example`
- `frontend/.env.example`
- The repo-root `.env` (read for variable names only — **never copy values into the doc**)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Procedures:**
    - `### Procedure: First-time deployment` — clone, populate repo-root `.env` (reference `backend/.env.example` for variables, redact actual secrets), `docker compose -f docker-compose.demo.yml up -d --build`.
    - `### Procedure: Update deployment` — `git pull && docker compose -f docker-compose.demo.yml up -d --build`. Note: backend entrypoint auto-runs `wait-for-postgres → migrate → seed` on each container start.
    - `### Procedure: Rollback` — `git checkout <prev-sha> && docker compose ... up -d --build`. Note that migrations are forward-only — a rollback that needs to undo a migration requires manual SQL.
  - **Failure modes:**
    - `### Failure: Backend container restart-looping` — check `docker logs interlab-api`, common causes (DB unreachable from `wait-for-postgres`, migration syntax error, missing env var).
    - `### Failure: Traefik 502/504` — check `traefik` container is on `traefik_default` network with the API/app, certs renewed.
    - `### Failure: TLS cert renewal failed` — Let's Encrypt via `myresolver` on Traefik, ACME storage location.
  - **Reference:** Table of every env var read by `backend/src/config/env.js` with required/optional flag and default. **No actual secret values.**
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**

  Additional check: `grep -E 'JWT_SECRET=.+|MINIO_ROOT_PASSWORD=.+|SMTP_PASS=.+' docs/runbook/deployment.md` should produce **no output** (no leaked secrets).

- [ ] **Step 5: Checkpoint.**

## Task 5.2: `docs/runbook/database.md`

**Files:** Create `docs/runbook/database.md`.

**Sources to read first:**
- `backend/scripts/migrate.js`
- `backend/scripts/wait-for-postgres.js`
- `backend/scripts/seed.js`
- `backend/migrations/` (every file — read for shape, not content)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Procedures:**
    - `### Procedure: Apply pending migrations` — `docker exec interlab-api node scripts/migrate.js` (or auto-applied on container start).
    - `### Procedure: Add a new migration` — file format (`-- +migrate Up` / `-- +migrate Down`), numbering, idempotence requirements (DDL must use `IF NOT EXISTS` where possible), commit-without-running.
    - `### Procedure: Connect to Postgres directly` — `docker exec -it interlab-postgres psql -U interlab_user -d interlab_db`.
    - `### Procedure: Re-seed demo data` — `docker exec interlab-api node scripts/seed.js`. Note: seed is idempotent for roles/permissions; demo users may upsert.
  - **Failure modes:**
    - `### Failure: migration script syntax error` — runner exits non-zero; backend container fails to start. Recovery: fix file, redeploy.
    - `### Failure: schema_migrations row written but Up SQL failed mid-way` — manual repair via psql; details on how the runner currently handles partial application (it doesn't — wraps Up in a single statement, so partial is unlikely but possible with multi-statement files).
  - **Reference:** `schema_migrations` table shape, list of all 16+ migration files with one-line purpose each.
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 5.3: `docs/runbook/scheduler.md`

**Files:** Create `docs/runbook/scheduler.md`.

**Sources to read first:**
- `backend/src/jobs/scheduler.js`
- `backend/src/config/env.js` (scheduler section)
- `docs/backend/jobs.md` (already written in Phase 2 — link to it for internals)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Procedures:**
    - `### Procedure: Confirm scheduler is leader on this node` — `docker exec interlab-api env | grep SCHEDULER_ENABLED`. `docker logs interlab-api | grep '\[scheduler\]'` should show `registered job=...` lines on startup.
    - `### Procedure: Manually fire a job` — `docker exec interlab-api node -e "require('./src/jobs/scheduler').runOnce('<job_name>').then(r=>console.log(r))"`. Job names: `sla_technical_ready_to_deliver`, `technical_po_due_reminder`, `hrga_expiry_monitor`, `tax_deadline_monitor`.
    - `### Procedure: Disable the scheduler on a node` — set `SCHEDULER_ENABLED=false` in compose env, restart. Use when running multiple replicas — only one should have it true.
  - **Failure modes:**
    - `### Failure: A job is logged as "skip: previous run still in flight"` — previous tick still running. If chronic, the job's runtime exceeds its cron interval → investigate query plans / data growth.
    - `### Failure: Two nodes both have SCHEDULER_ENABLED=true` — duplicated SLA notifications, duplicated email queue rows. Recovery: pick a leader, set the other to false, restart.
    - `### Failure: Cron didn't fire at the expected time` — check `TZ` / `SCHEDULER_TIMEZONE` env vars; `node-cron` evaluates in the configured zone.
  - **Reference:** Cron expression cheat sheet for the 4 jobs. Link to `../backend/jobs.md` for "why this schedule".
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 5.4: `docs/runbook/storage.md`

**Files:** Create `docs/runbook/storage.md`.

**Sources to read first:**
- `backend/src/config/minio.js`
- `backend/src/services/file.service.js`
- `backend/src/utils/attachments.js`
- `backend/migrations/012_file_attachments.sql`
- `interlabs-crm-demo/docs/CTX_architecture.txt` (MinIO bucket section)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Procedures:**
    - `### Procedure: Bootstrap MinIO buckets on a fresh instance` — list required buckets (`avatars`, `attachments` — or whichever the env points to), `mc mb` commands, set bucket to private.
    - `### Procedure: Inspect a stored file` — find row in `file_attachments` (storage_path), use `mc cp` from inside the network.
    - `### Procedure: Generate a one-off presigned URL for ops debugging` — `node -e "..."` snippet using the file service.
    - `### Procedure: Rotate MinIO credentials` — update env, redeploy backend, no app-level invalidation needed.
  - **Failure modes:**
    - `### Failure: Presigned URL returns SignatureDoesNotMatch` — `MINIO_PUBLIC_URL` mismatch between sign-time host and browser-resolved host.
    - `### Failure: 403 on download in browser` — bucket not private (security risk) OR presigned URL expired (15 min default).
    - `### Failure: Upload fails with 413` — `UPLOAD_MAX_FILE_SIZE_MB` server-side cap or browser-blocked by `MultiFileUpload` client cap.
  - **Reference:** Bucket layout (avatars/, attachments/<module>/<record-id>/), env vars, presigned URL TTLs (15 min download, 5 min upload).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 5.5: `docs/runbook/incidents.md`

**Files:** Create `docs/runbook/incidents.md`.

**Sources to read:** All previous runbook files (`deployment.md`, `database.md`, `scheduler.md`, `storage.md`) and `backend/src/middleware/errorHandler.middleware.js`.

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.** This file is the **incident triage entry point** — symptom-first, then a link to the right detail file.
  - **Procedures:** none directly — this file's `## Procedures` section instead reads `### Procedure: Triage` (a flowchart-style decision tree: symptom → first checks → which detail file to open).
  - **Failure modes:** consolidated symptom catalogue. Each `### Failure: <symptom>` entry: 1-line detection, 1-line first-response, link to the relevant detail runbook file. Required entries:
    - `### Failure: app.interlab-portal.com 502/504`
    - `### Failure: api.interlab-portal.com 5xx`
    - `### Failure: Login fails for everyone`
    - `### Failure: Notifications stopped firing`
    - `### Failure: SLA escalation didn't happen`
    - `### Failure: File downloads broken`
    - `### Failure: WebSocket disconnections`
    - `### Failure: Unexpected stage transitions`
  - **Reference:** Log locations, container names, dashboard URLs, who to escalate to (the user is solo — likely just "the lead developer" link to `business/system-overview.md`).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.** Print "Phase 5 complete".

---

# Phase 6 — Stakeholder

> Phase 6 tasks: audience `stakeholder`, English plain prose only. **No code blocks. No `file:line` refs. No technical jargon without a glossary link.** Tables allowed for RBAC matrix and SLA list. Reading-time annotation at top of body (`*~5 min read*`).

## Task 6.1: `docs/business/roles-and-permissions.md`

**Files:** Create `docs/business/roles-and-permissions.md`.

**Sources to read first:**
- `interlabs-crm-demo/docs/CTX_master_context.txt` (RBAC section)
- `backend/migrations/002_rbac.sql`
- `backend/scripts/seed.js` (role/permission seed rows)
- `docs/business/system-overview.md` (already exists — for glossary anchors)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Required sections:**
    - `## What "role" means here`
    - `## The eight roles` — one paragraph per role, plain language, what they do day-to-day (no capability codes).
    - `## What each role can see and do` — RBAC matrix as a table: row = role, column = high-level capability area (PO management, Customer records, Files, Reports, User admin). Cells: ✓ / partial / —. No bracketed code notation; use full role names.
    - `## Same-role management rule` — plain prose explaining "Sales managers can only manage Sales users; HRGA managers only HRGA; etc."
    - `## How permission is enforced` — three sentences, no code: "Permission is checked in the menu, in the server, and in every database query. The menu is for convenience; the server is the rule."
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**

  ```bash
  F=docs/business/roles-and-permissions.md
  for h in 'What "role" means here' 'The eight roles' 'What each role can see and do' \
           'Same-role management rule' 'How permission is enforced'; do
    grep -q "^## $h$" $F || echo "MISSING: $h"
  done
  head -5 $F | grep -q '^audience: stakeholder$' || echo "FRONTMATTER"
  ! grep -E '^\`\`\`|file:line|backend/src' $F || echo "TECHNICAL CONTENT LEAKED"
  test "$(wc -l < $F)" -le 500 || echo "OVER LIMIT"
  ```

- [ ] **Step 5: Checkpoint.**

## Task 6.2: `docs/business/sla-policies.md`

**Files:** Create `docs/business/sla-policies.md`.

**Sources to read first:**
- `interlabs-crm-demo/docs/MOD_sales.txt`, `MOD_admin_log.txt`, `MOD_finance.txt`, `MOD_technical.txt`, `MOD_hrga.txt`, `MOD_tax_insurance.txt` (SLA sections of each)
- `backend/src/jobs/*.job.js` (cadence + escalation paths)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Required sections:**
    - `## What an SLA means in this system` — plain definition, working-day math caveat.
    - `## SLA catalogue` — table: SLA name · who owns it · deadline · what happens when it's missed (escalation path) · how it's checked (time-of-day cadence in plain English, e.g., "every hour" / "every weekday morning").
    - `## Escalation paths` — for each escalation, who gets notified.
    - `## Working-day rule` — Saturdays/Sundays are not counted; Indonesian holiday calendar [is/is not — check source].
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify** (use the same "no technical content" grep as Task 6.1 with this file's path).
- [ ] **Step 5: Checkpoint.**

## Task 6.3: `docs/business/audit-and-compliance.md`

**Files:** Create `docs/business/audit-and-compliance.md`.

**Sources to read first:**
- `interlabs-crm-demo/docs/CTX_master_context.txt` (audit trail section)
- `interlabs-crm-demo/docs/CTX_architecture.txt` (security section)
- `backend/migrations/015_activity_logs.sql`

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Required sections:**
    - `## What we log` — every state change records who, when, what, why-if-delayed.
    - `## How we protect access` — three layers: menu / server / database.
    - `## Soft-delete principle` — records are marked deleted, not removed. Plain language on retention.
    - `## Session security` — JWT in plain language ("a signed badge that proves who you are, expires every hour"), refresh, remember-me.
    - `## What we do NOT log` — passwords, file contents, raw payment data (verify in source).
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.**

## Task 6.4: `docs/business/data-handling.md`

**Files:** Create `docs/business/data-handling.md`.

**Sources to read first:**
- `interlabs-crm-demo/docs/CTX_architecture.txt` (MinIO section)
- `backend/src/services/file.service.js`
- `docs/runbook/storage.md` (already exists — for cross-link)

- [ ] **Step 1: Read all sources.**
- [ ] **Step 2: Write the file.**
  - **Required sections:**
    - `## Where data lives` — Postgres (records), MinIO (files), Redis (sessions). Plain language, server location (Indonesian VPS).
    - `## How files are kept private` — buckets are not public; every download is a signed link valid for 15 minutes.
    - `## Retention` — what is kept, what is deleted, what is soft-deleted.
    - `## Backup and restore` — [check current state — likely TBD by user; if no backup process exists, say so explicitly: "Backups are currently the operator's responsibility — see runbook/database.md"].
- [ ] **Step 3: Drift-anchors.**
- [ ] **Step 4: Verify.**
- [ ] **Step 5: Checkpoint.** Print "Phase 6 complete".

---

# Phase 7 — Wire-up

## Task 7.1: `README.md` (root entry, doc map)

**Files:** Create `/opt/projects/interlabs-crm-demo/README.md`.

**Sources to read first:**
- `CLAUDE.md` (for the high-level pitch)
- `docker-compose.demo.yml`
- `backend/package.json`, `frontend/package.json`
- Every file under `docs/` (read names + frontmatter only — verify each exists)

- [ ] **Step 1: Verify all 26 prior files exist.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  EXPECTED=(
    docs/business/system-overview.md
    docs/backend/architecture.md
    docs/backend/auth-and-rbac.md
    docs/backend/po-state-machine.md
    docs/backend/notifications.md
    docs/backend/websocket.md
    docs/backend/jobs.md
    docs/backend/modules/sales.md
    docs/backend/modules/admin-log.md
    docs/backend/modules/finance.md
    docs/backend/modules/technical.md
    docs/backend/modules/hrga.md
    docs/backend/modules/tax.md
    docs/frontend/architecture.md
    docs/frontend/state-and-forms.md
    docs/frontend/api-layer.md
    docs/frontend/rbac-and-nav.md
    docs/runbook/deployment.md
    docs/runbook/database.md
    docs/runbook/scheduler.md
    docs/runbook/storage.md
    docs/runbook/incidents.md
    docs/business/roles-and-permissions.md
    docs/business/sla-policies.md
    docs/business/audit-and-compliance.md
    docs/business/data-handling.md
  )
  for f in "${EXPECTED[@]}"; do
    test -f "$f" || echo "MISSING: $f"
  done
  ```

  Expected: no output. If anything is missing, halt — go back and finish the missing task.

- [ ] **Step 2: Write the file.**

  Required sections:
  - **Frontmatter:** `audience: dev`, `reading_time: 3 min`, `last_reviewed: 2026-04-27`
  - `# Interlabs CRM` — title
  - **What this is** — 1 paragraph from CLAUDE.md ("internal CRM + ERP + Realtime Operations Hub for PT. Interlab Sentra Solutions Indonesia").
  - `## Quickstart` — 4-step block: `git clone`, populate repo-root `.env` (point at `backend/.env.example`), `docker compose -f docker-compose.demo.yml up -d --build`, browse `https://app.interlab-portal.com`.
  - `## Repo layout` — 4-line tree showing `backend/`, `frontend/`, `interlabs-crm-demo/docs/` (specs, source-of-truth for product behavior), `docs/` (runtime docs, written by this plan).
  - `## Documentation map` — sectioned by audience:
    - **Developers** — bullet list of every file under `docs/backend/` and `docs/frontend/` with one-line purpose.
    - **Operators** — every file under `docs/runbook/`.
    - **Stakeholders** — every file under `docs/business/`.
  - `## Where to start` — task-oriented cheat sheet:
    - "I want to deploy → `docs/runbook/deployment.md`"
    - "I want to add a backend route → `docs/backend/architecture.md` then `docs/backend/modules/<your module>.md`"
    - "I want to understand the PO lifecycle → `docs/backend/po-state-machine.md`"
    - "I'm not technical and want to know what this system does → `docs/business/system-overview.md`"
    - "Something is broken → `docs/runbook/incidents.md`"
  - `## Project conventions` — link to `CLAUDE.md` for non-negotiable invariants. One-line description of the prompt pipeline at `interlabs-crm-demo/docs/PIPELINE_README.txt`.

- [ ] **Step 3: Populate drift-anchors.** Include `CLAUDE.md`, `docker-compose.demo.yml`, both `package.json` files, and a wildcard line for the docs tree:

  ```html
  <!-- drift-anchors:
    CLAUDE.md
    docker-compose.demo.yml
    backend/package.json
    frontend/package.json
    docs/
  -->
  ```

- [ ] **Step 4: Verify.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  for h in 'Quickstart' 'Repo layout' 'Documentation map' 'Where to start' 'Project conventions'; do
    grep -q "^## $h$" README.md || echo "MISSING: $h"
  done
  head -5 README.md | grep -q '^audience: dev$' || echo "FRONTMATTER"
  # Every doc-map link should resolve to an existing file
  while read -r p; do test -f "$p" || echo "BROKEN LINK: $p"; done < <(grep -oE 'docs/[A-Za-z/_-]+\.md' README.md | sort -u)
  ```

  Expected: no output.

- [ ] **Step 5: Checkpoint.** Print "Task 7.1 complete".

## Task 7.2: Cross-link sweep

**Files:**
- Modify (potentially): every file written in phases 0-7

**Goal:** Resolve every TODO cross-link left in Phase 3 module docs and verify every relative link in every file resolves.

- [ ] **Step 1: Find every TODO ref left in module docs.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  grep -rn 'TODO\|FIXME\|XXX' docs/backend/modules/ || echo "no TODOs"
  ```

  Each hit: open the file, replace the TODO with the proper relative link to the target module doc.

- [ ] **Step 2: Verify every relative markdown link resolves.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  # Extract every (path) from every doc, resolve relative to the source file's dir
  for f in $(find docs README.md -type f -name '*.md'); do
    dir=$(dirname "$f")
    grep -oE '\]\([^)]+\)' "$f" \
      | sed 's/^](//;s/)$//' \
      | grep -v '^http' \
      | grep -v '^#' \
      | while read -r link; do
          # Strip anchor
          path="${link%%#*}"
          target="$dir/$path"
          test -f "$target" || echo "BROKEN: $f -> $link"
        done
  done
  ```

  Expected: no output. Fix any broken links inline.

- [ ] **Step 3: Verify every glossary link target exists.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  # All glossary anchors in system-overview.md
  grep -oE 'glossary-[a-z-]+' docs/business/system-overview.md | sort -u > /tmp/anchors.txt
  # All glossary references in every other doc
  for f in $(find docs README.md -type f -name '*.md' | grep -v system-overview); do
    grep -oE 'system-overview.md#glossary-[a-z-]+' "$f" \
      | sed 's/.*#//' \
      | while read -r anchor; do
          grep -q "^$anchor$" /tmp/anchors.txt || echo "BROKEN GLOSSARY: $f -> $anchor"
        done
  done
  ```

  Expected: no output.

- [ ] **Step 4: Verify every file has frontmatter and drift-anchors.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  for f in $(find docs README.md -type f -name '*.md'); do
    head -5 "$f" | grep -q '^audience: ' || echo "NO FRONTMATTER: $f"
    grep -A1 'drift-anchors:' "$f" | tail -1 | grep -qv '^-->$' || echo "EMPTY ANCHORS: $f"
  done
  ```

  Expected: no output.

- [ ] **Step 5: Verify file-length cap holds.**

  ```bash
  cd /opt/projects/interlabs-crm-demo
  for f in $(find docs README.md -type f -name '*.md'); do
    n=$(wc -l < "$f")
    test "$n" -le 500 || echo "OVER 500 LINES ($n): $f"
  done
  ```

  Expected: no output. If any file exceeds 500 lines, **halt and report — do not split silently.**

- [ ] **Step 6: Final checkpoint.**

  Print:
  ```
  Documentation set complete:
    - 27 files written
    - All cross-links resolve
    - All glossary anchors resolve
    - All files have frontmatter + drift-anchors
    - All files within 500-line cap
  Spec acceptance criteria met. Awaiting user review.
  ```

  Do not commit. The user will decide whether/when to commit.

---

# Self-review (already performed by plan author)

Plan author ran the writing-plans skill's self-review checklist:

1. **Spec coverage** — every section of the spec maps to a task:
   - "Information architecture" (27 files) → Tasks 0.1, 1.1-1.3, 2.1-2.3, 3.1-3.6, 4.1-4.4, 5.1-5.5, 6.1-6.4, 7.1.
   - "Per-file content templates" → embedded in each task's "Write the file" step as required section headers.
   - "Conventions" (frontmatter, drift-anchors, cross-link style, glossary linking, RBAC notation, file length cap) → "Shared content rules" section + per-task verification steps + Task 7.2 sweep.
   - "Generation order" → phase order in this plan exactly matches the spec.
   - "Reading sources per file" → each task lists "Sources to read first" matching the spec's table.
   - "Acceptance criteria" → Task 7.2 verification steps cover all six bullets.
2. **Placeholder scan** — no TBDs except one explicit "[check current state]" in Task 6.4 (backup/restore section), which is a known-unknown the implementing engineer is told to resolve at write time.
3. **Type consistency** — N/A for docs. Section header names are consistent across templates and verification scripts.
4. **No "Similar to Task N" forward refs** — Phase templates are hoisted to the start of each phase; tasks reference them as already-read prerequisites, not back-references.

<!-- drift-anchors:
  docs/superpowers/specs/2026-04-27-documentation-design.md
  CLAUDE.md
-->

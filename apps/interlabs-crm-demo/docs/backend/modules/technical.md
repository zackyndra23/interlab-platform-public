---
audience: dev
reading_time: 13 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- backend/src/routes/technical.routes.js
- backend/src/services/technical.service.js
- backend/src/validators/technical.validators.js
- backend/src/services/po.service.js
- backend/src/services/finance.service.js
- backend/src/services/notification.service.js
- backend/src/jobs/slaReadyToDeliver.job.js
- backend/src/jobs/slaPoDueDate.job.js
- backend/src/jobs/scheduler.js
- backend/migrations/008_technical_forms.sql
- backend/migrations/013_sla_and_workflow.sql
- frontend/lib/technical-api.ts
- frontend/lib/technical-types.ts
- frontend/lib/technical-ui.ts
- frontend/app/(app)/technical/
- interlabs-crm-demo/docs/MOD_technical.txt
-->

# Technical module

## Purpose

The Technical division owns the engineering side of the **[PO](../../business/system-overview.md#glossary-po)** lifecycle — the work that happens after goods arrive and before Finance issues the customer invoice. It runs every Job Order, performs incoming **Inspection / QC**, executes **Installation** and **Preventive Maintenance** on customer sites, ships **Spareparts** under workshop check, and produces the **[BAST](../../business/system-overview.md#glossary-bast)** that closes out billable work. Three of the eleven stages in `../po-state-machine.md` are owned here:

- **Stage 7 — Inspected** (entered from QC `Approved + Submitted`, or from an Installation row whose `inspection_status='Complete'` and `function_test_status='Pass'`).
- **Stage 9 — Installation** (entered when `installation_records.installation_start_date` first becomes present).
- **Stage 10 — BAST** (entered from any of three handoff paths — see [Automations](#automations)).

Service entry-point: `backend/src/services/technical.service.js`. Every stage transition is funneled through `poService.advanceStatus` so the four-invariant contract from `CLAUDE.md` (history + tracking + notification + `purchase_orders.current_status`) cannot be bypassed; module code never writes `current_status` directly. The role lookup for `[Technical]` matches the **[Technical](../../business/system-overview.md#glossary-technical)** glossary entry, and is wired in the same way as **[Sales](../../business/system-overview.md#glossary-sales)**, **[Admin & Log](../../business/system-overview.md#glossary-admin-log)**, and **[Finance](../../business/system-overview.md#glossary-finance)** in their respective service files.

## Forms / entities owned

Six forms, six tables — one Joi validator group per form, one route mount per form, one service section per form. Created by `backend/migrations/008_technical_forms.sql` (which also closes the forward FK `invoice_customers.related_bast_id → bast_records.id`):

| Form | Table | Record number prefix | Owns lifecycle stages |
|------|-------|----------------------|-----------------------|
| Job Order | `technical_job_orders` | `TJO-` (`recordNumbers.js TECHNICAL_PREFIXES.JOB_ORDER`) | none directly — anchors the others |
| Installation | `installation_records` | n/a (FK to job order) | drives Inspected, Installation, BAST |
| Inspection / QC | `inspection_qc_records` | `QC-` (`TECHNICAL_PREFIXES.QC`) | drives Inspected |
| Sparepart | `sparepart_records` | n/a | RTD trigger for Admin & Log SLA |
| PM | `pm_records` | n/a | drives BAST |
| BAST | `bast_records` | `BAST-` (`TECHNICAL_PREFIXES.BAST`) | drives BAST |

The Job Order is the parent record: every Installation, PM, and Sparepart row hangs off `related_job_order_id` (`008_technical_forms.sql:58, 116, 141`), and a Job Order in turn binds to a master PO via `related_po_id` (`008_technical_forms.sql:20`). A Job Order's `support_team_members` is a native `uuid[]` of users (`008_technical_forms.sql:29`) so a Technical-team broadcast can `= ANY()` against it.

## Routes

Mounted under `/api/technical/*` (see `backend/src/routes/technical.routes.js:1-388`). All routes pass through `authMiddleware` (line 14) and a per-route `rbacGuard(feature, capability)`. Listing scope is enforced server-side via `technicalScopeUserId` at `technical.routes.js:19-25`: Superadmin / CEO / Technical see everything; every other role is scoped to `created_by = req.user.id` (parity with `financeScopeUserId` and `adminLogScopeUserId`).

| Method + path | RBAC | Validator | Service |
|---------------|------|-----------|---------|
| `GET /job-orders` | `[technical_job_order:view_own]` | `jobOrderListQuery` | `listJobOrders` |
| `GET /job-orders/:id` | `[technical_job_order:view_own]` | `idParam` | `getJobOrder` |
| `POST /job-orders` | `[technical_job_order:create]` | `jobOrderCreate` | `createJobOrder` |
| `PUT /job-orders/:id` | `[technical_job_order:edit]` | `jobOrderUpdate` | `updateJobOrder` |
| `DELETE /job-orders/:id` | `[technical_job_order:delete]` | `idParam` | `deleteJobOrder` |
| `GET /installations` | `[installation:view_own]` | `installationListQuery` | `listInstallations` |
| `GET /installations/:id` | `[installation:view_own]` | `idParam` | `getInstallation` |
| `POST /installations` | `[installation:create]` | `installationCreate` | `createInstallation` |
| `PUT /installations/:id` | `[installation:edit]` | `installationUpdate` | `updateInstallation` |
| `PUT /installations/:id/ready-to-deliver` | `[installation:write]` | `readyToDeliverRequest` | `markReadyToDeliver` |
| `DELETE /installations/:id` | `[installation:delete]` | `idParam` | `deleteInstallation` |
| `GET /pm` | `[pm:view_own]` | `pmListQuery` | `listPm` |
| `GET /pm/:id` | `[pm:view_own]` | `idParam` | `getPm` |
| `POST /pm` | `[pm:create]` | `pmCreate` | `createPm` |
| `PUT /pm/:id` | `[pm:edit]` | `pmUpdate` | `updatePm` |
| `DELETE /pm/:id` | `[pm:delete]` | `idParam` | `deletePm` |
| `GET /spareparts` | `[sparepart:view_own]` | `sparepartListQuery` | `listSparepart` |
| `GET /spareparts/:id` | `[sparepart:view_own]` | `idParam` | `getSparepart` |
| `POST /spareparts` | `[sparepart:create]` | `sparepartCreate` | `createSparepart` |
| `PUT /spareparts/:id` | `[sparepart:edit]` | `sparepartUpdate` | `updateSparepart` |
| `DELETE /spareparts/:id` | `[sparepart:delete]` | `idParam` | `deleteSparepart` |
| `GET /inspection-qc` | `[inspection_qc:view_own]` | `qcListQuery` | `listQc` |
| `GET /inspection-qc/:id` | `[inspection_qc:view_own]` | `idParam` | `getQc` |
| `POST /inspection-qc` | `[inspection_qc:create]` | `qcCreate` | `createQc` |
| `PUT /inspection-qc/:id` | `[inspection_qc:edit]` | `qcUpdate` | `updateQc` |
| `PUT /inspection-qc/:id/submit-review` | `[inspection_qc:approve]` | `qcSubmitReview` | `submitQcReview` |
| `DELETE /inspection-qc/:id` | `[inspection_qc:delete]` | `idParam` | `deleteQc` |
| `GET /bast` | `[bast:view_own]` | `bastListQuery` | `listBast` |
| `GET /bast/:id` | `[bast:view_own]` | `idParam` | `getBast` |
| `POST /bast` | `[bast:create]` | `bastCreate` | `createBast` |
| `PUT /bast/:id` | `[bast:edit]` | `bastUpdate` | `updateBast` |
| `PUT /bast/:id/send-to-finance` | `[bast:write]` | `bastSendToFinance` | `sendBastToFinance` |
| `DELETE /bast/:id` | `[bast:delete]` | `idParam` | `deleteBast` |

The `[Superadmin, CEO]` roles bypass scoping and inherit `full_access` so every guard above is permissive for them. RBAC layering details live in `../auth-and-rbac.md`.

## Validators

`backend/src/validators/technical.validators.js` defines one Joi schema group per form. All UUIDs are `uuidv4`; all date fields are ISO `Joi.date().iso()`; list queries inherit `page` / `limit` / `search` from the shared `listQuery` (`technical.validators.js:9-13`). The constrained value-sets (mirroring the SQL `CHECK` constraints in `008_technical_forms.sql`):

- **Job types** (`technical.validators.js:22`): `'Installation' | 'PM' | 'Sparepart'`.
- **Job Order workflow** (line 24): `'draft' | 'active' | 'completed' | 'cancelled'`.
- **Installation phases** (lines 71-74): `pre_installation, workshop, ready_to_deliver, scheduling, on_site, commissioning, completed`.
- **Delivery method** (line 75): `'Pick Up Forwarder' | 'Hand Carry'`.
- **Admin & Log response** (line 76): `'pending' | 'acknowledged' | 'dispatched'`.
- **PM workflow** (line 126): `'scheduled' | 'in_progress' | 'completed'`.
- **Sparepart workflow** (line 159): `'awaiting_awb' | 'workshop_check' | 'ready' | 'dispatched'`.
- **QC review status** (line 194): `'Pending Review' | 'Reviewed' | 'Approved'` — forward-only, enforced by `submitQcReview` at `technical.service.js:1306-1312`.
- **QC final-submit** (line 195): `'Draft' | 'Submitted'`.
- **BAST workflow** (line 233): `'draft' | 'submitted' | 'sent_to_finance'`.

Trigger-bearing fields are themselves validators — `bast_upload_file_ids` (`technical.validators.js:100`), `bastp_file_ids` (line 140), `billing_support_file_ids` (line 171), and the `qcSubmitReview` body (lines 217-220) are the wire that lights up the automations described below.

## Services

`backend/src/services/technical.service.js` is the only mutator. Every public function that crosses a PO stage runs inside `db.withTransaction` so the four-invariant contract (`po.service.js:241-355`) and the in-band Finance handoff (`finance.service.js`) commit or rollback together.

Shared helpers (`technical.service.js:55-199`):

- `listRows` — generic paginated list with `deleted_at IS NULL`, optional `search ILIKE`, scope-by-creator, and `extraFilters` per form.
- `requireRow` — fetch-or-throw `NotFoundError`, runner-aware so it works inside a transaction.
- `attachFilesToEntity` — binds `file_attachments` rows to a `(related_module, related_entity_id)` pair; throws if any IDs are missing (`technical.service.js:121-126`).
- `lookupPoNumber` — denormalize `(po_number, customer_id, due_at)` for snapshot fields on Job Order create.
- `resolvePoCustomer` — lift the Finance-side `po_customer_records` row from a master PO so `financeService.createInvoiceCustomerDraftFromBast` can wire `poCustomerId` and `customerId` correctly.
- `createBastRecordForHandoff` (`technical.service.js:172-199`) — materializes a real `bast_records` row when Installation or PM auto-hand-off, because `invoice_customers.related_bast_id` is FK-constrained to `bast_records(id)` (`fk_invoice_customers_bast`); without it the Finance draft insert would fail.

Per-form services:

- **Job Order** — `listJobOrders, getJobOrder, createJobOrder, updateJobOrder, deleteJobOrder` (`technical.service.js:205-389`). Create snapshots `(related_po_number, po_due_date, customer_id)` from the PO and fires `technical.job_order.created` to the assigned engineer + `support_team_members` + `[Technical, Superadmin, CEO]`. Update is locked when `workflow_status ∈ {completed, cancelled}` (line 317). Delete is rejected when `workflow_status='active'` (line 379).
- **Installation** — `listInstallations, getInstallation, createInstallation, updateInstallation, markReadyToDeliver, deleteInstallation` (`technical.service.js:395-790`). Create / update / RTD all funnel into `runInstallationAutomation` (lines 441-591) — the four triggers documented below.
- **PM** — `listPm, getPm, createPm, updatePm, deletePm` (`technical.service.js:796-979`). Create / update funnel into `runPmAutomation` (lines 859-919) — the BASTP handoff trigger.
- **Sparepart** — `listSparepart, getSparepart, createSparepart, updateSparepart, deleteSparepart` (`technical.service.js:985-1183`). Triggers consolidated in `runSparepartAutomation` (lines 1023-1085) — RTD + billing handoff.
- **Inspection / QC** — `listQc, getQc, createQc, updateQc, submitQcReview, deleteQc` (`technical.service.js:1189-1378`). Update is locked once `final_submit_status='Submitted'` (line 1255); `submitQcReview` advances master PO → Inspected (lines 1340-1360).
- **BAST** — `listBast, getBast, createBast, updateBast, sendBastToFinance, deleteBast` (`technical.service.js:1384-1598`). Update / delete are locked once `workflow_status='sent_to_finance'`. `sendBastToFinance` is the canonical Stage 10 transition (lines 1509-1584).

Test hooks `runInstallationAutomation, runPmAutomation, runSparepartAutomation` are exported (`technical.service.js:1614`) so unit tests can drive the automation pure-function-style with synthetic `before`/`after` rows.

## DB tables

`backend/migrations/008_technical_forms.sql` creates six tables. Every table carries the project-wide invariants — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `timestamptz` audit columns, `created_by` / `updated_by` FKs to `users(id)`, and a `deleted_at` soft-delete column.

| Table | FK in | FK out | Notable columns |
|-------|-------|--------|-----------------|
| `technical_job_orders` | `purchase_orders`, `customers`, `users` | `installation_records`, `pm_records`, `sparepart_records`, `inspection_qc_records`, `bast_records` | `support_team_members uuid[]`, `due_date_reminder_flag bool`, `po_due_date date` |
| `installation_records` | `technical_job_orders` (CASCADE), `purchase_orders` | none | `pre_installation_status, workshop_check_status, inspection_status, function_test_status, ready_to_deliver, admin_log_response_status, workflow_phase, ready_to_deliver_at` |
| `pm_records` | `technical_job_orders` (CASCADE), `purchase_orders`, `users` | none | `pm_schedule_date, pm_start_date, pm_end_date, workflow_status` |
| `sparepart_records` | `technical_job_orders` (CASCADE), `purchase_orders`, `awb_records` | none | `workshop_check_status, ready_to_deliver, admin_log_response_status, workflow_status` |
| `inspection_qc_records` | `technical_job_orders`, `purchase_orders`, `users` | none | `qc_record_number UNIQUE, item_condition, defect_category, qc_result, review_status, final_submit_status` |
| `bast_records` | `technical_job_orders`, `purchase_orders`, `customers`, `users` | `invoice_customers.related_bast_id` (FK closed at `008_technical_forms.sql:241-245`) | `bast_record_number UNIQUE, job_type, sent_to_finance, sent_to_finance_at, workflow_status` |

Inspection / QC and Sparepart join Technical to other modules: `inspection_qc_records.related_po_id` is the entry-point for Stage 7; `sparepart_records.related_awb_id` (`008_technical_forms.sql:143`) lets Admin & Log link sparepart shipments back to a real AWB. The `installation_records.workflow_phase` enum is internal-only — it is *not* a master PO stage.

## Notifications fired

Every emit goes through `notificationService.emit(client, {...})` inside the same transaction as the state change (so a notification is never sent for a write that rolled back). Recipients are derived from the matching `notification_templates` row (extra `roles` list + per-user opt-ins) plus the `extraRoles` / `extraRecipientUserIds` passed at the call site. A disabled template suppresses *all* delivery, per `CLAUDE.md`. Cross-link: `../notifications.md`.

| Template key | Call sites | Default `extraRoles` | Trigger |
|--------------|------------|----------------------|---------|
| `technical.job_order.created` | `technical.service.js:298` | `[technical, superadmin, ceo]` + assigned engineer + support team | Job Order POST |
| `technical.po.inspected` | (via `poService.advanceStatus`) `technical.service.js:459, 1341` | `[admin_log, finance, superadmin, ceo]` | Inspection complete + function test pass, **or** QC Approved + Submitted |
| `technical.po.installation` | `technical.service.js:471` | `[superadmin, ceo, sales]` | `installation_start_date` first present |
| `technical.installation.ready_to_deliver` | `technical.service.js:511, 1051` | `[admin_log, superadmin, ceo]` | RTD `'Yes'` on Installation **or** Sparepart |
| `technical.qc.completed` | `technical.service.js:1351` | `[technical, superadmin, ceo]` | QC Approved + Submitted |
| `technical.bast.submitted` | `technical.service.js:569, 900, 1571` | `[finance, superadmin, ceo]` | All three Stage-10 BAST paths |
| `technical.po.bast` | (via `poService.advanceStatus`) `technical.service.js:559, 890, 1560` | `[finance, superadmin, ceo]` | All three Stage-10 BAST paths |
| `technical.billing.handoff` | `technical.service.js:1072` | `[finance, superadmin, ceo]` | Sparepart `billing_support_file_ids` provided |
| `technical.po.due_date_reminder` | `slaPoDueDate.job.js:51` | `[technical]` + assigned engineer + support team | 30-day SLA reminder (see [SLA hooks](#sla-hooks)) |

## Automations

Cross-link: `../po-state-machine.md`. Three of the eleven stages have entry triggers in this module; two of them have multiple paths.

### Stage 7 — Inspected (2 paths)

- **Path A (QC):** `submitQcReview` (`technical.service.js:1293-1364`) when the incoming `(review_status, final_submit_status)` becomes `(Approved, Submitted)`. Forward-only; the second submit is rejected by the guard at line 1313. Calls `poService.advanceStatus({newStatus:'Inspected'})` and emits `technical.qc.completed` in parallel.
- **Path B (Installation):** `runInstallationAutomation` Trigger 1 (`technical.service.js:452-468`) when `inspection_status='Complete'` AND `function_test_status='Pass'` AND the previous row did not already satisfy both. Calls `advanceStatus({newStatus:'Inspected'})` directly.
- **Race:** whichever path lands first wins. The second path advances no-op because `po.service.js:259` rejects `current_status === newStatus`.

### Stage 9 — Installation (1 path)

`runInstallationAutomation` Trigger 2 (`technical.service.js:470-481`) when `installation_start_date` first becomes present (`!before.installation_start_date && after.installation_start_date`). Idempotent on subsequent updates.

### Stage 10 — BAST (3 paths)

All three paths converge on the same fan-out: materialize a real `bast_records` row if needed, create the Finance Invoice Customer draft via `financeService.createInvoiceCustomerDraftFromBast`, advance master PO → BAST, emit `technical.bast.submitted` + `technical.po.bast` + (from Finance) `finance.invoice_customer.registered`. Cross-link: `./finance.md`.

- **Path A (canonical BAST form):** `sendBastToFinance` (`technical.service.js:1509-1584`). Pre-conditions: `workflow_status != 'sent_to_finance'` and `related_po_id` present. Flips `workflow_status='sent_to_finance', sent_to_finance=true, sent_to_finance_at=now()`.
- **Path B (Installation auto-handoff):** `runInstallationAutomation` Trigger 4 (`technical.service.js:525-588`). Lit when `bast_upload_file_ids` is provided on Installation create / update. Idempotent: skipped when `before.workflow_phase='completed'` (line 533). Sets `installation_records.workflow_phase='completed'` after.
- **Path C (PM BASTP handoff):** `runPmAutomation` (`technical.service.js:859-919`). Lit when `bastp_file_ids` is provided on PM create / update. Idempotent: skipped when `pm_records.workflow_status='completed'`. Sets `pm_records.workflow_status='completed'` after.

### Other triggers (no PO-stage change)

- **Installation Trigger 3 — Ready-to-Deliver:** `runInstallationAutomation` (`technical.service.js:483-523`) when `ready_to_deliver` first transitions to `'Yes'`. Sets `ready_to_deliver_at=now()`, `admin_log_response_status='pending'`, advances `workflow_phase` to `'ready_to_deliver'` if it was `pre_installation` or `workshop`. Clears `sla_tracking.overdue_at` / `escalation_sent_at` for `entity_type='installation_records.ready_to_deliver'` so the monitor can re-fire (lines 501-508). Emits `technical.installation.ready_to_deliver` to `[Admin & Log, Superadmin, CEO]`. **Outgoing handoff** to Admin & Log — see `./admin-log.md` for the downstream RTD acknowledgement / dispatch flow.
- **Sparepart RTD / Billing:** `runSparepartAutomation` (`technical.service.js:1023-1085`) — the RTD half mirrors Installation Trigger 3 exactly (same template key, same SLA reset, `sparepart_records.workflow_status='ready'`); the billing-support half binds `billing_support_file_ids` and emits `technical.billing.handoff` but does **not** advance the PO (BAST handoff is canonical for that).
- **Incoming from Admin & Log:** Stage 6 → 7 is the inbound boundary. Admin & Log sets `awb_records.arrival_date`, master PO advances to Arrived (`admin_log.service.js`), Technical's QC / Installation work then begins. There is no in-band write across the boundary — Technical reads the master PO state.

## SLA hooks

Cross-link: `../jobs.md`. Two cron jobs touch Technical-owned data; the per-job dedupe contract is documented in the job module itself.

### `sla_technical_ready_to_deliver` (hourly, `0 * * * *`)

- **Job:** `slaReadyToDeliver.job.js`. Wired into the registry at `scheduler.js:39-46`.
- **Scope:** scans both `installation_records` (entity_type `'installation_records.ready_to_deliver'` — `slaReadyToDeliver.job.js:21`) and `sparepart_records` (entity_type `'sparepart_records.ready_to_deliver'` — line 22) where `ready_to_deliver='Yes'` AND `admin_log_response_status='pending'` for >2 working days.
- **Trigger source vs. SLA target:** Technical is the *trigger source* — it sets `ready_to_deliver='Yes'` (Installation Trigger 3, Sparepart RTD trigger) and clears the `sla_tracking` row so the next hourly tick re-evaluates. Admin & Log is the *SLA target* — the escalation notification fires *to* `[Admin & Log, Superadmin, CEO]` because it is Admin & Log's response that is overdue. Technical's only obligation is to set the start signal cleanly; Admin & Log owns the dispatch deadline.
- **Notification:** `admin_log.ready_to_deliver.overdue_response` (per `../jobs.md`).

### `technical_po_due_reminder` (daily 08:00 WIB, `0 8 * * *`)

- **Job:** `slaPoDueDate.job.js`. Wired into the registry at `scheduler.js:48-54`.
- **Owned by Technical:** the entire job acts on `technical_job_orders` only. Scans rows where `workflow_status ∈ {draft, active}`, `due_date_reminder_flag=false`, and `po_due_date` falls within the next 30 days (`slaPoDueDate.job.js:20-35`).
- **Idempotency:** sets `due_date_reminder_flag=true` after notifying so the same Job Order does not re-fire (line 39). If the PO due date is later revised forward past the 30-day window, an operator (Superadmin/CEO) must clear the flag; this job will not unset it on its own (`slaPoDueDate.job.js:11-13`).
- **Notification:** `technical.po.due_date_reminder` to assigned engineer + `support_team_members` + `[Technical]`.

```js
// slaPoDueDate.job.js:51-63 (truncated)
await notificationService.emit(client, {
    templateKey: 'technical.po.due_date_reminder',
    title: `PO ${jo.related_po_number || jo.related_po_id} due in ≤30 days`,
    message: `Technical Job Order ${jo.technical_job_order_number} — `
        + `PO due on ${...}`,
    module: 'technical',
    entityType: 'technical_job_orders',
    entityId: jo.id,
    extraRecipientUserIds,
    extraRoles: ['technical'],
});
```

The HRGA expiry monitor (`hrga_expiry_monitor`) and tax-deadline monitor (`tax_deadline_monitor`) run on the same daily 08:00 WIB tick but do not touch Technical-owned tables.

## Frontend pages

All routes nest under `frontend/app/(app)/technical/` with the AppShell layout from `../../frontend/...` enforcing the `[Technical]` (and `[Superadmin, CEO]`) menu visibility.

| Page | Route segment |
|------|---------------|
| Job Order list | `technical/job-orders/page.tsx` |
| Job Order new | `technical/job-orders/new/page.tsx` |
| Job Order detail | `technical/job-orders/[id]/page.tsx` |
| Job Order edit | `technical/job-orders/[id]/edit/page.tsx` |
| Installation list | `technical/installations/page.tsx` |
| Installation new / detail / edit | `technical/installations/{new,[id],[id]/edit}/page.tsx` |
| PM list / new / detail / edit | `technical/pm/{page.tsx, new, [id], [id]/edit}` |
| Sparepart list / new / detail / edit | `technical/spareparts/{page.tsx, new, [id], [id]/edit}` |
| Inspection-QC list / new / detail / edit | `technical/inspection-qc/{page.tsx, new, [id], [id]/edit}` |
| BAST list / new / detail / edit | `technical/bast/{page.tsx, new, [id], [id]/edit}` |

Client API surface lives in `frontend/lib/technical-api.ts` (six exported objects: `jobOrdersApi`, `installationsApi`, `pmApi`, `sparepartsApi`, `inspectionQcApi`, `bastApi`); response shapes in `frontend/lib/technical-types.ts`; shared select-options / status-color helpers in `frontend/lib/technical-ui.ts`.

## Cross-references

- `../po-state-machine.md` — canonical Stage 7 / 9 / 10 contract that this module's automations enter.
- `../notifications.md` — emit semantics, template lookup, opt-in rules.
- `../jobs.md` — scheduler wiring, working-day math, idempotency contract for the two Technical-relevant cron jobs.
- `../auth-and-rbac.md` — RBAC layering and `[Superadmin, CEO]` bypass details for the routes table.
- `./admin-log.md` — downstream consumer of `technical.installation.ready_to_deliver` and the SLA target for `sla_technical_ready_to_deliver`; AWB linkage for `sparepart_records.related_awb_id`.
- `./finance.md` — downstream consumer of all three Stage-10 BAST handoff paths via `financeService.createInvoiceCustomerDraftFromBast`; emits `finance.invoice_customer.registered` alongside Technical's `technical.bast.submitted`.
- `interlabs-crm-demo/docs/MOD_technical.txt` — the original product spec; this doc is the implementation truth, the spec is the intent.

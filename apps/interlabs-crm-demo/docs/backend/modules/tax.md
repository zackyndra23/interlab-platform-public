---
audience: dev
reading_time: 9 min
last_reviewed: 2026-04-27
---

# Tax & Insurance module

The Tax & Insurance division owns Indonesian tax compliance bookkeeping: SSP payments, SPT filings, the **[Masa Pajak](../../business/system-overview.md#glossary-masa-pajak)** period board, and the only monthly cron in the system. It is the **only module without a tie into the 11-stage PO lifecycle** — it neither consumes nor produces stage transitions. Everything here is regulator-facing operational record-keeping plus a deadline monitor.

## Purpose

The module persists every tax obligation **PT. Interlab Sentra Solutions Indonesia** files or pays, keeping a regulator-grade audit trail and surfacing closed Masa Pajak obligations that are still missing payment or filing.

- **Operational tax records** — one row per SSP payment, SPT filing, or combined record (`tax_operational_records`). Indexed by `tax_type` (PPh 21 / PPh 25 / PPN / Others), `tax_category` (SSP Payment / SPT Reporting / Combined Record), and Masa Pajak (month + year, or just `tahun_pajak` for annual SPT).
- **Masa Pajak periods** — not a separate table; the period is encoded on each record as `masa_pajak` (date, first-of-month canonical), `masa_pajak_month`, `masa_pajak_year`. Period normalization is centralised in `backend/src/services/tax.service.js:98-130`.
- **SPT records** — sub-shape of `tax_operational_records` where `tax_category` IN (`SPT Reporting`, `Combined Record`) and the SPT-only fields (`jenis_spt`, `status_spt`, `reporting_date`, `attachment_spt_file_ids`) are populated. **[SPT](../../business/system-overview.md#glossary-spt)** filing detection (Rule 3 in the deadline monitor) keys off `reporting_date IS NULL` for these categories.
- **Audit log** — `tax_operational_audit_log` mirrors every create / update / status change / archive with a JSONB diff. Drives the regulator-facing "Audit" panel on the record detail page.
- **Dashboard** — five aggregate views (current Masa Pajak board, monthly summary by tax_type, PPN summary, recent activity, pending actions) defined under `/api/tax/dashboard/*`.
- **Monthly deadline monitor** — `tax_deadline_monitor` cron, the only thing in the system on a `0 8 1 * *` schedule. Three independent rules; see [SLA hooks](#sla-hooks) below.

The module is the **sole tenant of `tax_*` tables** — no other module reads or writes them. Cross-module reads are restricted to `users` (for `pic_user_id`) and `file_attachments` (for SSP/SPT/payment/supporting files).

## Forms / entities owned

| Entity | Shape | Owner |
|--------|-------|-------|
| Operational tax record | `tax_operational_records` row, with file groups in `file_attachments` (`related_module` ∈ `tax.ssp`, `tax.spt`, `tax.payment`, `tax.supporting`) | **[Tax & Insurance](../../business/system-overview.md#glossary-tax-insurance)** |
| Masa Pajak period | Encoded on records (`masa_pajak`, `masa_pajak_month`, `masa_pajak_year`); no standalone entity | (implicit) |
| SPT record | Same row as operational record; SPT fields gated by `tax_category` (`SPT Reporting` / `Combined Record`) | **[Tax & Insurance](../../business/system-overview.md#glossary-tax-insurance)** |
| Audit log entry | `tax_operational_audit_log` row, JSONB `changed_fields` diff, immutable (delete prohibited at the route layer) | **[Tax & Insurance](../../business/system-overview.md#glossary-tax-insurance)** |

Conditional field visibility — gated by `tax_category` — is enforced at three layers (Joi `when()`, service `enforceCategoryGate`, frontend hide):

- `SSP Payment` records: SPT-only fields (`jenis_spt`, `status_spt`, `reporting_date`, `attachment_spt_file_ids`) are forbidden (`backend/src/services/tax.service.js:35-43`).
- `SPT Reporting` records: SSP-only fields (`billing_code`, `ntpn`, `ntb`, `stan`, `bank_name`, `payment_date`, `amount`, `currency`, `attachment_ssp_file_ids`, `attachment_payment_file_ids`) are forbidden (`backend/src/services/tax.service.js:39-43`).
- `Combined Record` records: all fields permitted.

The service re-applies the gate against the **stored** category when an update body omits `tax_category`, so a caller cannot sneak a forbidden field in by leaving the discriminator out (`backend/src/services/tax.service.js:362-363`).

`npwp` accepts both legacy 15-digit and Coretax 16-digit forms, ignoring separators (`backend/src/validators/tax.validators.js:34-43`). Field is `NOT NULL`.

## Routes

All routes are mounted under `/api/tax`, defined in `backend/src/routes/tax.routes.js`, all behind `authMiddleware`. RBAC is enforced via `rbacGuard('tax_operational', <capability>)` — the `tax_operational` feature is the only Tax-owned feature key (`backend/scripts/seed.js:59,97`).

| Method | Path | Capability | Handler |
|--------|------|------------|---------|
| `GET` | `/dashboard/current-masa-pajak` | `view_own` | `tax.routes.js:38` |
| `GET` | `/dashboard/monthly-summary/:taxType` | `view_own` | `tax.routes.js:46` |
| `GET` | `/dashboard/ppn-summary` | `view_own` | `tax.routes.js:58` |
| `GET` | `/dashboard/recent-activity` | `view_own` | `tax.routes.js:67` |
| `GET` | `/dashboard/pending-actions` | `view_own` | `tax.routes.js:75` |
| `GET` | `/operational` | `view_own` | `tax.routes.js:87` |
| `GET` | `/operational/:id` | `view_own` | `tax.routes.js:100` |
| `POST` | `/operational` | `create` | `tax.routes.js:109` |
| `PUT` | `/operational/:id` | `edit` | `tax.routes.js:120` |
| `PUT` | `/operational/:id/status` | `edit` | `tax.routes.js:131` |
| `DELETE` | `/operational/:id` | `delete` | `tax.routes.js:142` |
| `GET` | `/operational/:id/audit` | `view_own` | `tax.routes.js:158` |

Dashboard routes are deliberately mounted **above** `/operational/:id` so `dashboard/...` is not captured by the `:id` UUID param (`tax.routes.js:32-36`). Dedicated `:id/status` endpoint exists so the audit log records an unambiguous `action='status_changed'` rather than `'updated'` (`tax.routes.js:131-140`, `tax.service.js:449`).

**Listing scope** (`tax.routes.js:20-26`): Superadmin / CEO / Tax & Insurance see all rows. Any other role that somehow reaches the listing route falls back to `created_by = req.user.id` per-creator scoping. In practice only `[Tax & Insurance, Superadmin, CEO]` are granted `tax_operational.view_own`, so the fallback is a defense-in-depth path. See [auth-and-rbac.md](../auth-and-rbac.md).

## Validators

All Joi validators in `backend/src/validators/tax.validators.js`:

- `taxOperationalCreate` (`:161`) — requires `tax_type`, `tax_category`, `npwp`. SPT/SSP gates applied via `Joi.when('tax_category', ...)` blocks (`:57-131`).
- `taxOperationalUpdate` (`:173`) — `tax_type` / `tax_category` / `npwp` optional, body must have `.min(1)`. Service re-applies the gate when `tax_category` is absent.
- `taxOperationalStatusChange` (`:182`) — accepts only `record_status`, `payment_status`, `payment_date`, `reporting_date`, `note` (`.min(1)`).
- `taxOperationalListQuery` (`:194`) — search + tax_type / tax_category / record_status / payment_status / pic_user_id / npwp / masa_pajak_month / masa_pajak_year / tahun_pajak / masa_pajak_from / masa_pajak_to.
- `taxAuditListQuery` (`:208`) — `action` ∈ {`created`, `updated`, `status_changed`, `archived`}, `actor_user_id`, date range.
- `dashboardQuery` (`:215`) — `months` 1-24 (default 12), `tahun_pajak`.
- `npwpValidator` (`:34-43`) — strips separators, requires 15 or 16 digits.

Enum values mirror the migration 010 CHECK constraints exactly (`tax.validators.js:21-27`).

## Services

`backend/src/services/tax.service.js` is the single service. Five operation classes:

| Class | Functions | Notes |
|-------|-----------|-------|
| CRUD | `listRecords`, `getRecord`, `createRecord`, `updateRecord`, `changeStatus`, `deleteRecord` | Soft delete, `Verified` / `Archived` blocks delete (`:564-569`); `Archived` blocks edits (`:354-358`) |
| Audit log | `listAuditLog`, internal `writeAuditLog`, `computeDiff`, `snapshotForAudit` | Diff is JSONB `{field: {old, new}}` against the `PERSISTED_FIELDS` set (`:48-57`) |
| Notifications | `emitLifecycleNotifications` | Fires `tax.record.submitted` / `.verified` / `.paid` on actual transitions (`:501-555`) |
| Attachment binding | `bindAllAttachments`, `attachFilesToEntity` | Maps the four attachment groups to `related_module` keys; verifies count matches (`:73-77`) |
| Dashboard | `dashboardCurrentMasaPajak`, `dashboardMonthlySummary`, `dashboardPpnSummary`, `dashboardRecentActivity`, `dashboardPendingActions` | All read-only aggregates; `pendingActions` is the data source for Widget 6 |

`tax.record.created` is fired inline from `createRecord` (`:320-331`) inside the same transaction, so a notification is never emitted for a record that failed to commit. Lifecycle notifications follow the same pattern.

The record number sequence is generated by `nextRecordNumber(c, 'tax_operational_records', 'tax_operational_record_number', TAX_PREFIXES.OPERATIONAL)` inside the create transaction (`:269-272`).

## DB tables

Migration 010 (`backend/migrations/010_tax_insurance.sql`) defines:

- **`tax_operational_records`** (`:20-82`) — primary entity. UUIDv4 PK, `timestamptz` everywhere, soft delete via `deleted_at`, `created_by` / `updated_by` FK to `users`. CHECK constraints enforce the same enum values as the validators. **All conditional fields are nullable** — gating happens above the DB so `Combined Record` rows can hold the full superset (`010_tax_insurance.sql:9-12`).
- **`tax_operational_audit_log`** (`:89-99`) — immutable mutation log. `changed_fields` JSONB, `action` ∈ {`created`, `updated`, `status_changed`, `archived`}, FK `record_id` `ON DELETE CASCADE` so a hard purge of a record (not via the soft-delete path) removes its audit chain.

Indexes (`backend/migrations/014_indexes.sql:166-174`):

- `idx_tax_op_masa_pajak (masa_pajak_month, masa_pajak_year)` — drives the dashboard board and the deadline monitor.
- `idx_tax_op_tax_type`, `idx_tax_op_record_status`, `idx_tax_op_payment_status`, `idx_tax_op_npwp`, `idx_tax_op_pic` — list filters.
- `idx_tax_op_audit_record (record_id)`, `idx_tax_op_audit_created (created_at)` — audit log lookup + ordering.

File metadata lives in `file_attachments` per the `related_module` keys (`tax.ssp`, `tax.spt`, `tax.payment`, `tax.supporting`) bound by `bindAllAttachments` (`tax.service.js:183-196`); MinIO bytes are private and accessed only via presigned URLs per the [architecture.md](../architecture.md) attachment contract.

## Notifications fired

Six template codes — all in template group `Tax & Insurance`. See [notifications.md](../notifications.md) for the centralised catalogue and the disabled-template suppression rule.

| Template key | Trigger | Recipients |
|--------------|---------|------------|
| `tax.record.created` | New record inserted (`tax.service.js:321`) | `[Tax & Insurance, Superadmin, CEO]` + `pic_user_id` |
| `tax.record.submitted` | `record_status` Draft/etc → `Submitted` (`tax.service.js:507`) | `[Tax & Insurance, Superadmin, CEO]` + PIC |
| `tax.record.paid` | `payment_status` → `Paid` AND `payment_date` populated (`tax.service.js:542`) | `[Tax & Insurance, Superadmin, CEO]` + PIC |
| `tax.record.verified` | `record_status` → `Verified` (`tax.service.js:522`) | `[Tax & Insurance, Superadmin, CEO]` + PIC |
| `tax.reminder.unpaid` | `taxDeadlineMonitor.job` Rule 1 (missing record) and Rule 2 (unpaid closed Masa Pajak); same template key carries both kinds (`taxDeadlineMonitor.job.js:221, 247`) | `[Tax & Insurance, Superadmin, CEO]` + PIC (Rule 2 only) |
| `tax.reminder.spt_not_filed` | `taxDeadlineMonitor.job` Rule 3 (`taxDeadlineMonitor.job.js:267`) | `[Tax & Insurance, Superadmin, CEO]` + PIC |

`tax.record.paid` is intentionally guarded on **both** `payment_status` becoming `Paid` AND `payment_date` being populated (`tax.service.js:539-540`); a Paid transition without a payment_date is logged but not announced. Attachment presence is best-effort — missing SSP files do not block the status change but the spec advises `payment_date + attachment entered` for the announcement.

## Automations

- **Incoming**: none. The Tax & Insurance module is read-only from the perspective of every other module's services. No PO stage, no Sales / Admin & Log / Finance / Technical / HRGA write triggers a tax record.
- **Outgoing into PO lifecycle**: none. The 11-stage PO state machine ([po-state-machine.md](../po-state-machine.md)) does not consume any tax event; `tax_operational_records` carry no `purchase_order_id` FK and no `purchase_order_status_history` row is written from this module.

This isolation is intentional. Tax compliance is a regulator-facing concern with its own deadlines and audit retention; tying it to PO state would couple two unrelated lifecycles. If a future module needs to project tax data onto a PO, it should read `tax_operational_records` directly and not the other way around.

## SLA hooks

A single cron — `tax_deadline_monitor` — registered in `backend/src/jobs/scheduler.js:62-69` with cron expression `0 8 1 * *` (1st of month at 08:00 WIB). Scheduler timezone is `Asia/Jakarta` per the global setup. Implementation in `backend/src/jobs/taxDeadlineMonitor.job.js`. See [jobs.md](../jobs.md) for the full job catalogue and the scheduler invariants.

The job evaluates the **previous** Masa Pajak (`previousMasaPajak`, `:39-44`) — if today is May 1, it scans Masa Pajak April. Three independent rules execute in one transaction:

1. **Rule 1 — missing required record** (`:212-238`). `findMissingRequired` reports any `tax_type` in `REQUIRED_TAX_TYPES = ['PPh 21', 'PPh 25', 'PPN']` that has no record for the closed Masa Pajak. `'Others'` is deliberately excluded — catch-all bucket, not mandatory monthly. Emits `tax.reminder.unpaid` with `entityId: null`.
2. **Rule 2 — unpaid closed Masa Pajak** (`:240-258`). Records with `payment_status='Unpaid'`, `record_status<>'Archived'`, and `masa_pajak < date_trunc('month', now())`. Emits `tax.reminder.unpaid` with the record id.
3. **Rule 3 — SPT not filed** (`:260-278`). Records with `tax_category IN ('SPT Reporting','Combined Record')`, `reporting_date IS NULL`, `record_status<>'Archived'`, and a closed Masa Pajak. Emits `tax.reminder.spt_not_filed`.

**Idempotency** is via `sla_tracking` rows tagged with custom `entity_type` keys (`taxDeadlineMonitor.job.js:30-32`):

- `tax_operational_records.reminder_unpaid` — keyed by record id + stage `'unpaid'`.
- `tax_operational_records.reminder_spt_not_filed` — keyed by record id + stage `'spt_not_filed'`.
- `tax_operational_records.reminder_missing_record` — keyed by `md5(taxType||month||year)::uuid` (synthetic id, since there is no record yet) + stage `'<TaxType>:YYYY-MM'`.

A reminder fires at most once per (entity, stage); subsequent monthly ticks are no-ops. The closed-window check (`masa_pajak < date_trunc('month', now())`) means running the job late still picks up every historically closed month, so a missed first-of-month tick is recoverable.

Note: there is **no acknowledge path** that clears a reminder when the underlying state is fixed (e.g. Unpaid → Paid). The reminder stays in `sla_tracking`; the dashboard's Pending Actions widget is the live signal. See `taxDeadlineMonitor.job.js:23-28`.

## Frontend pages

Routes under `frontend/app/(app)/tax/operational/`. The module's left-nav entry is gated on the `tax_operational` feature.

| Path | File | Purpose |
|------|------|---------|
| `/tax/operational` | `frontend/app/(app)/tax/operational/page.tsx` | List + filter bar (search, tax_type, category, record_status, payment_status, masa_pajak month/year, tahun_pajak). Uses `<DataTable>` with the columns mapped to `taxOperationalApi.list` |
| `/tax/operational/new` | `frontend/app/(app)/tax/operational/new/page.tsx` | Create form, conditional sections by `tax_category` |
| `/tax/operational/[id]` | `frontend/app/(app)/tax/operational/[id]/page.tsx` | Detail view, includes audit log panel |
| `/tax/operational/[id]/edit` | `frontend/app/(app)/tax/operational/[id]/edit/page.tsx` | Edit form |

API client wrappers: `frontend/lib/tax-api.ts` (`taxOperationalApi`, `taxDashboardApi`). Types in `frontend/lib/tax-types.ts` mirror the migration 010 column set 1:1. UI helpers (status-badge variant maps, enum lists, Masa Pajak / NPWP formatters) in `frontend/lib/tax-ui.ts`.

The dashboard widgets defined in `MOD_tax_insurance.txt` §Widgets 1-6 read from `taxDashboardApi` — there is no dedicated dashboard page in `(app)/tax/`; widgets are surfaced from the global dashboard. Widget 6 ("Pending Actions") binds to `dashboardPendingActions` and shows drafts >7d, unpaid records past `payment_date`, and SPT-obligated records missing `reporting_date` for closed Masa Pajak (`tax.service.js:723-762`).

## Cross-references

- [auth-and-rbac.md](../auth-and-rbac.md) — `tax_operational` feature, `tax_insurance` role grants, `view_own` listing scope semantics.
- [notifications.md](../notifications.md) — full template catalogue including the `tax.*` group, the disabled-template suppression rule, and the recipient-resolution flow.
- [jobs.md](../jobs.md) — `tax_deadline_monitor` registration, scheduler invariants (single-leader, in-flight lock, working-day math), `runOnce` operator dry-run.
- [architecture.md](../architecture.md) — attachment / MinIO contract used by `bindAllAttachments`.
- `interlabs-crm-demo/docs/MOD_tax_insurance.txt` — original module specification (forms, dashboard widgets, conditional field logic, notification events). Authoritative when this doc disagrees with the code.

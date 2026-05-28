# D1 — Dashboard Data Breadth & Variation (Design)

- **Date:** 2026-05-26
- **Working dir:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo`
- **Branch:** `feat/sub2-lite-po-types-dummy-data` (foundation Sub-2-lite + Sub-4 already here, unpushed; D1 builds on it)
- **Target env:** live demo / staging — Postgres `interlab_staging` @ postgres-global, minio-global, run via `docker exec interlab-api`.
- **Status:** approved design, pre-implementation

---

## 0. Context

After seeding ~100 POs (Sub-4), the user tested as superadmin and found most dashboard widgets across roles are **empty or single-valued** (e.g. Quotation Status all `accepted`, PO Pipeline all `processed`), and several modules (Sales Forecast, HPP, Technical job details, HRGA, Tax, Activity Log, Chat) are entirely empty. The originating feedback (12 items) was decomposed into **D1 (data breadth & variation)** and **D2 (dashboard UI redesign)**. The user chose **D1 first**.

**D1 goal:** every dashboard widget on **every role** is non-empty and **every status/condition is represented** (no widget shows 0), plus seeded Activity Logs for all roles and 1:1 Chat bubbles — so each role gets a realistic, useful daily-monitoring picture. This extends the existing `seed-dummy.js` (Sub-4); it is data + one small additive migration, **no UI changes** (those are D2).

### Why widgets are empty/flat today (verified)
- `quotations` + `sales_purchase_orders` **are** seeded but with a hardcoded single status → need variation.
- These tables are **never seeded** today and back empty widgets: `sales_forecasts`, `harga_pokok_penjualan`, `purchase_requests_sales`, `po_customer_records`, `invoice_manufactures`, `technical_job_orders`, `installation_records`, `pm_records`, `sparepart_records`, `inspection_qc_records`, `admin_operational_records`, `hrga_legal_documents`, `company_letters`, `hrga_archive_records`, `tax_operational_records`, `tax_operational_audit_log`, `activity_logs`, all `chat_*` tables.
- `users` has **no `last_login_at`** column; "Online Now" is live-WebSocket only (cannot be seeded — stays truthful).

---

## 1. Scope / non-goals

**In scope (D1):** seed + vary all the data above; +6 demo staff users; `users.last_login_at` migration + seeding; Activity Log history for all roles; Chat DM bubbles; extend the manifest/`--reset` teardown to cover everything new.

**Out of scope (→ D2):** all dashboard UI/layout work (KPI scoreboards, max-5 lists + "view all", bar/line/pie charts via a chart lib, less scrolling) — items 1–3; and the **UI** of item 11 (showing "last login / logged-in-since" columns + the Online-Now presentation). D1 only lands the *data + column* those will consume.

**Hard rules:** additive only; reuse existing tables (no new domain tables); never touch the 8 real accounts except adding `last_login_at`; everything seeded is namespaced/manifested and fully removable via `--reset`.

---

## 2. Approach

### 2.1 Modularize the seeder
`scripts/seed-dummy.js` (~250 lines) becomes a package `scripts/seed-dummy/`:
- `index.js` — CLI entry, arg parse (`--reset`), DB/MinIO bootstrap, manifest load/save, orchestration, refuse-if-exists guard, `teardown`.
- `lib.js` — existing pure helpers (`planTypeDistribution`, `formatRecordNumber`, `terminPlanFor`, `buildTimeline`) + new pure helpers (e.g. `spreadStatuses(values, n)` → array guaranteeing ≥1 of each value).
- `po.js` — the existing PO-flow seeding (customers, typed POs, history/tracking, linked QT/SO/PR/AWB/DO/BAST, invoice termins, attachments, notifications) moved verbatim from today's `seed-dummy.js`.
- `users.js`, `sales.js`, `finance.js`, `technical.js`, `adminlog.js`, `hrga.js`, `tax.js`, `activity.js`, `chat.js` — new per-domain seeders.

`backend/scripts/seed-dummy.js` is replaced by `backend/scripts/seed-dummy/index.js`; the run command becomes `node scripts/seed-dummy/index.js [--reset]`. The manifest file moves to `scripts/seed-dummy/.manifest.json` (gitignored).

### 2.2 Coverage-first variety rule (the core principle)
For **every** status/enum column of every seeded entity: the seeder first emits **≥1 row per allowed value**, then adds extra rows for volume/realism. A shared pure helper `spreadStatuses(values, n)` returns an array of length `n` that contains every value at least once (round-robin/weighted). This guarantees **no widget bucket is ever 0**. Volume target: POs bumped to **~120**; other entities **~15–40 each** (enough to cover values + look populated).

---

## 3. Backend change — Migration `033`

`033_users_last_login.sql` (idempotent, Up/Down): `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;`. Nullable, no default. Test: column exists, nullable timestamptz. (No other schema needed — all entity tables exist in migrations 005–010.)

---

## 4. Demo users (`users.js`)

Seed **+6 staff users**, one per division (`sales, admin_log, finance, technical, hrga, tax`), at **rank-1 (staff)** `level_id` (seeded by `seed.js`). Email pattern `staff.<division>.demo@interlab-portal.com` (so teardown matches `email LIKE '%.demo@%'` without touching the 8 real accounts), `account_status='active'`, password = `DEMO_PASSWORD` (loginable), `display_name` like "Sales Staff (Demo)". Record their ids in the manifest. These enable intra-department Manager↔Staff chat and broaden activity-log/role coverage.

---

## 5. Per-module data (every status value gets ≥1 row)

Implementation reads the exact columns/CHECKs from migrations 005–010 at code time; values below are the variety targets. Link to existing POs where natural; otherwise standalone.

### 5.1 Sales (`sales.js`)
- **Vary existing** `quotations.workflow_status` over `{draft, submitted, revised, accepted, rejected}`; `sales_purchase_orders.workflow_status` over `{draft, submitted, processed, overdue}`. Also vary `step_status` `{on_track, overdue}` so SLA Alerts populate.
- **Seed** `sales_forecasts` — cover the forecast `stage` (`Prospect, Qualified, Proposal, Negotiation, Won, Lost`) **and** `workflow_status` (`draft, submitted, closed`); realistic IDR values so Forecast Pipeline shows spread.
- **Seed** `harga_pokok_penjualan` — `workflow_status` `{draft, submitted, approved}`.
- **Seed** `purchase_requests_sales` — `workflow_status` `{draft, submitted, copied_to_finance}`.

### 5.2 Finance (`finance.js`)
- **Seed** `po_customer_records` — `workflow_status` `{registered, active, invoiced, completed}` + `current_po_status` spread; link `related_po_id` to existing POs (covers PO Production/Invoice boards).
- **Seed** `invoice_manufactures` — `payment_status` `{Unpaid, Paid}` (+ `payment_date`/amount on Paid); link via `related_pr_id`/`related_po_id`.
- **Ensure** `invoice_customers.invoice_status` has both `{Registered, Processed}` and `purchase_requisitions.current_pr_status` has both `{Registered, Processed}` (today's PO seeder skews one way).

### 5.3 Technical (`technical.js`)
- **Seed** `technical_job_orders` — `workflow_status` `{draft, active, completed, cancelled}` × `job_type` `{Installation, PM, Sparepart}` (every combination ≥1); link to POs.
- **Seed** `installation_records` — `inspection_status` `{Pending, In Progress, Complete}`, `function_test_status` `{Pending, Pass, Fail}`, `admin_log_response_status` `{pending, acknowledged, dispatched}`, `ready_to_deliver` `{Yes, No}`.
- **Seed** `pm_records` — `workflow_status` `{scheduled, in_progress, completed}`.
- **Seed** `sparepart_records` — `workflow_status` `{awaiting_awb, workshop_check, ready, dispatched}` + `admin_log_response_status` `{pending, acknowledged, dispatched}`.
- **Seed** `inspection_qc_records` — `review_status` `{Pending Review, Reviewed, Approved}`, `final_submit_status` `{Draft, Submitted}`.
- **Ensure** `bast_records.workflow_status` covers `{draft, submitted, sent_to_finance}` (today only `sent_to_finance`).

### 5.4 Admin & Log (`adminlog.js`)
- **Ensure** `awb_records.current_awb_status` covers `{Registered, Processed, Arrived}` and `delivery_orders.current_do_status` covers `{Registered, Arrived}` (add standalone rows if PO-derived spread misses a value).
- **Seed** `admin_operational_records` — `expense_status` `{Pending, Paid, Cancelled}`, `workflow_status` `{draft, submitted, reviewed}`, varied categories/amounts (Monthly Operational widget).

### 5.5 HRGA (`hrga.js`)
- **Seed** `hrga_legal_documents` — `document_status` `{Draft, Active, Expiring Soon, Expired, Superseded, Archived}` × `compliance_flag` `{ok, expiring_soon_90, expiring_soon_30, expired}` (every flag ≥1, with matching `expiry_date`s so Compliance Alert + Upcoming Renewals show all conditions).
- **Seed** `company_letters` — `letter_status` `{Draft, Under Review, Final, Sent, Archived}`.
- **Seed** `hrga_archive_records` — `archive_reason` `{Superseded, Expired, Withdrawn, Other}`.

### 5.6 Tax (`tax.js`)
- **Seed** `tax_operational_records` — `tax_type` `{PPh 21, PPh 25, PPN, Others}` × `payment_status` `{Unpaid, Paid, Pending, Failed}` × `record_status` `{Draft, Submitted, Verified, Archived}` (cover all values; spread across recent `masa_pajak` months so Current Masa Pajak + Monthly/PPN summaries render trends).
- **Seed** `tax_operational_audit_log` rows referencing those records (Recent Tax Activity widget).

## 6. Activity log (`activity.js`)
Seed `activity_logs` for **all roles** (8 real + 6 demo staff): varied `action` `{login, logout, create, update, delete, export, view}` with realistic `resource_type`/`resource_id` pointing at seeded records (PO, quotation, invoice, legal doc, tax record, …), `user_email`/`user_role` denormalized, `detail` jsonb, timestamps backdated over ~30 days. Guarantee **every role has ≥ several entries** and every `action` value appears. Online-Now is left to live WebSocket (truthful).

## 7. last_login (`users.js`)
Set `users.last_login_at` to a realistic recent timestamp for every user (8 real + 6 demo) — spread from "minutes ago" to "days ago" so the future D2 "last login / logged-in since" UI has data. `--reset` nulls `last_login_at` for the demo-affected users.

## 8. Chat (`chat.js`)
**1:1 DM bubbles only** (`chat_channels.channel_type='dm'` + two `chat_channel_members`), **no groups**. Targets:
- **≥80 messages** total; **each role ≥10** bubbles (as sender and/or recipient across its threads).
- **Superadmin and CEO each have a DM thread with every other role** (so leadership has bubbles from/with all roles).
- Mix of **cross-department** (e.g. Sales↔Finance, Admin&Log↔Technical, Finance↔Tax) **and intra-department Manager↔Staff** (real account ↔ the matching `*.demo` staff).
- Content: realistic **Bahasa Indonesia** follow-ups referencing seeded PO/document numbers (e.g. "PO-DEMO-2026-00012 sudah masuk Customs belum?"), backdated `created_at`, some with `chat_message_reads` to vary read state.
- A pure helper builds the thread/pair plan to guarantee the ≥10-per-role and superadmin/CEO-with-all coverage.

## 9. Integration, idempotency & safety
- One orchestrator run seeds everything; all new rows are namespaced (`*-DEMO-*` record numbers; `*.demo@` emails; chat/activity/last_login tracked via manifest ids).
- **`--reset` teardown extended** to delete — in FK-safe order — all new module rows (by namespace + manifest ids), the demo chat (`chat_messages`/`chat_message_reads`/`chat_channel_members`/`chat_channels` for demo channels), seeded `activity_logs`, the 6 demo users, and to NULL `last_login_at` it set; plus the existing PO/doc/attachment/notification teardown. Manifest cleared after.
- Runs via `docker exec interlab-api node scripts/seed-dummy/index.js --reset`. Migration `033` applies on container restart (entrypoint `migrate`).
- DB-only integration test (vitest, `crmdemo_test`, `SEED_DUMMY_NO_FILES=1`, small `SEED_DUMMY_COUNT`) asserts the coverage rule (see §10).

## 10. Acceptance criteria
1. Migration `033` adds nullable `users.last_login_at`; existing suite green.
2. Modular seeder runs; PO-flow behavior unchanged (existing seed-dummy integration assertions still pass after the move).
3. For every status/enum column listed in §5 (quotations, sales_po, forecasts, hpp, sales PR, po_customer, invoice_manufacture, invoice_customer, finance PR, job_orders×job_type, installations, pm, spareparts, qc, bast, awb, do, operational, legal docs×compliance_flag, company_letters, archive, tax records): **a `GROUP BY status` query returns ≥1 row for every allowed value** (the "nothing is 0" guarantee) — covered by integration-test assertions over a representative subset + a full live verification in §11.
4. `activity_logs`: every role (8 real + 6 demo) has ≥1 entry; every `action` value present.
5. Chat: ≥80 messages; every role ≥10; superadmin & CEO each have a thread with all other roles; ≥1 intra-dept Manager↔Staff thread.
6. 6 demo staff users exist (rank-1, `*.demo@`, active); all users have non-null `last_login_at`.
7. `--reset` removes 100% of D1 + Sub-4 seeded data (incl. demo users, chat, activity) and the manifest; re-run is idempotent (no duplication, no leftover).
8. Live run against staging: superadmin + each role login shows non-empty, varied widgets.

## 11. Live verification (gated, after user OK)
Rebuild `interlab-api`, restart (applies `033`), `docker exec ... seed-dummy/index.js --reset`, then a verification script printing `GROUP BY status` counts per entity (assert no zero buckets) + chat/activity coverage, then user logs in per role.

## 12. Risks & mitigations
- **Big seeder / many tables** → modular files + the `spreadStatuses` helper keep each domain small and the coverage rule mechanical.
- **Exact columns/CHECKs differ from this summary** → implementation reads migrations 005–010 first; the variety lists here are targets, not verbatim DDL.
- **Demo login accounts on live demo** → clearly namespaced `*.demo@`, active for realistic chat/activity, fully removed by `--reset`.
- **Long single transaction** (more inserts than Sub-4) → seed per-domain in separate transactions (not one giant tx) to keep each bounded; manifest accumulates ids across them.
- **Writing to live demo** → namespaced + `--reset` rollback + manual gated run.

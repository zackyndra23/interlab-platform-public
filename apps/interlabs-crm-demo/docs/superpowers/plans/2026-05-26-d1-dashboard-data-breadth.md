# D1 — Dashboard Data Breadth & Variation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dashboard widget on every role non-empty and varied (every status value has ≥1 row — no zero buckets), plus seed Activity Logs for all roles, +6 demo staff users, `users.last_login_at`, and ≥80 1:1 chat bubbles — by extending the existing dummy seeder into a modular package.

**Architecture:** Refactor `scripts/seed-dummy.js` into `scripts/seed-dummy/` (index orchestrator + `lib.js` pure helpers + `po.js` (existing flow) + per-domain modules). A shared `spreadStatuses(values, n)` helper guarantees ≥1 row per status value. Each domain module seeds its tables in its own transaction, recording ids in the shared manifest; `--reset` removes everything. One additive migration adds `users.last_login_at`.

**Tech Stack:** Node 20 CJS, raw `pg`, numbered migrations, vitest against `crmdemo_test`, MinIO (skipped under `SEED_DUMMY_NO_FILES`).

---

## Conventions (read once)

- **Test/migrate env** (from `backend/`):
  ```bash
  export PATH="/home/zaky/.nvm/versions/node/v20.20.2/bin:$PATH"
  PW=$(sudo grep -E "^interlab_staging01_password=" /root/.coolify-secrets-backup.txt | cut -d= -f2-)
  export DATABASE_URL="postgresql://interlab_staging01:${PW}@127.0.0.1:5440/crmdemo_test"
  ```
  Use this same `DATABASE_URL` for `node scripts/migrate.js` AND `npx vitest run`. Ignore pre-existing env failures (redis/avatar/SMTP/permission).
- **Migration markers:** `-- +migrate Up` / `BEGIN;…COMMIT;` / `-- +migrate Down` / `BEGIN;…COMMIT;`. Latest existing = `032`.
- **Local per-task commits, NO push.** Commit only the task's files. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Coverage rule:** every domain module, for each status/enum column it owns, must produce **≥1 row per allowed CHECK value** (use `spreadStatuses`). Volume per entity is fixed to guarantee coverage (NOT tied to PO count) + a little extra. Reuse the existing `po.js` INSERT style.
- **Namespacing:** record numbers `<PREFIX>-DEMO-...`; demo users `staff.<division>.demo@interlab-portal.com`. Everything goes in the manifest and is removed by `--reset`.
- Implementers may read the cited migration (005–010, 011, 015) for any column not in the appendix.

## Schema appendix (REQUIRED cols + status CHECK values)

Global: `id` auto; `created_at/updated_at` default now(); nullable `created_by/updated_by`, `deleted_at`; `currency` defaults `'IDR'`. "REQ" = NOT NULL, no default → must be in INSERT.

- **sales_forecasts** (005:30) — REQ `forecast_record_number`(UNIQUE), `product_or_service_name`. Status: `stage`∈{Prospect,Qualified,Proposal,Negotiation,Won,Lost}; `workflow_status`∈{draft,submitted,closed}; `step_status`∈{on_track,overdue}. `estimated_value numeric`, `customer_id`,`pic_user_id` FK.
- **harga_pokok_penjualan** (005:109) — REQ `hpp_record_number`(UNIQUE). Status: `workflow_status`∈{draft,submitted,approved}; `step_status`∈{on_track,overdue}. `total_cost`,`total_selling_price`,`gross_margin_total`; `customer_id`,`related_quotation_id` FK.
- **purchase_requests_sales** (005:184) — REQ `pr_record_number`(UNIQUE). `workflow_status`∈{draft,submitted,copied_to_finance}; `step_status`∈{on_track,overdue}. `related_po_id`→sales_purchase_orders.
- **po_customer_records** (007:18) — REQ `po_customer_record_number`(UNIQUE). `workflow_status`∈{registered,active,invoiced,completed}; `current_po_status` free text. `related_po_id`→purchase_orders, `customer_id`. `subtotal/tax_amount/total_amount`.
- **invoice_manufactures** (007:94) — REQ `invoice_manufacture_record_number`(UNIQUE). `payment_status`∈{Unpaid,Paid} (+`payment_date`,`payment_amount` on Paid). `related_pr_id`→purchase_requisitions, `related_po_id`. `total_amount`.
- **technical_job_orders** (008:17) — REQ `technical_job_order_number`(UNIQUE), **`related_po_id`(NOT NULL→purchase_orders RESTRICT)**, **`job_type`∈{Installation,PM,Sparepart}**. `workflow_status`∈{draft,active,completed,cancelled}; `priority`∈{Low,Medium,High,Critical}(nullable). `assigned_engineer_id`,`customer_id` FK.
- **installation_records** (008:56) — REQ **`related_job_order_id`(NOT NULL→technical_job_orders CASCADE)**. No record-number. `pre_installation_status`∈{Pending,In Progress,Complete}; `workshop_check_status`∈{Pending,In Progress,Passed,Failed}; `inspection_status`∈{Pending,In Progress,Complete}; `function_test_status`∈{Pending,Pass,Fail}; `admin_log_response_status`∈{pending,acknowledged,dispatched}; `workflow_phase`∈{pre_installation,workshop,ready_to_deliver,scheduling,on_site,commissioning,completed}; `ready_to_deliver`∈{Yes,No}(nullable). `related_po_id` FK.
- **pm_records** (008:114) — REQ **`related_job_order_id`(NOT NULL CASCADE)**. No record-number. `workflow_status`∈{scheduled,in_progress,completed}. `related_po_id`,`assigned_engineer_id` FK.
- **sparepart_records** (008:139) — REQ **`related_job_order_id`(NOT NULL CASCADE)**. No record-number. `workflow_status`∈{awaiting_awb,workshop_check,ready,dispatched}; `admin_log_response_status`∈{pending,acknowledged,dispatched}; `workshop_check_status`∈{Pending,In Progress,Passed,Failed}. `related_po_id`,`related_awb_id` FK.
- **inspection_qc_records** (008:171) — REQ `qc_record_number`(UNIQUE). `review_status`∈{Pending Review,Reviewed,Approved}; `final_submit_status`∈{Draft,Submitted}; `defect_category`∈{None,Physical,Functional,Documentation}(NOT NULL default None). `related_job_order_id`,`related_po_id`,`pic_user_id` FK.
- **admin_operational_records** (006:116) — REQ `operational_record_number`(UNIQUE), `reporting_month date`(NOT NULL, first-of-month). `expense_status`∈{Pending,Paid,Cancelled}; `workflow_status`∈{draft,submitted,reviewed}. `amount`,`expense_category`,`department`. `related_po_id` FK.
- **hrga_legal_documents** (009:22) — REQ `legal_document_record_number`(UNIQUE), `document_name`. `document_status`∈{Draft,Active,Expiring Soon,Expired,Superseded,Archived}; `compliance_flag`∈{ok,expiring_soon_90,expiring_soon_30,expired}; `access_scope`∈{hrga_only,all_roles,specific_roles}. `expiry_date date`. `tags text[]` default. (leave `search_document` NULL.)
- **company_letters** (009:82) — REQ `letter_record_number`(UNIQUE), `subject`. `letter_status`∈{Draft,Under Review,Final,Sent,Archived}; `access_scope`∈{hrga_only,all_roles,specific_roles}.
- **hrga_archive_records** (009:120) — REQ `archive_record_number`(UNIQUE), `source_module`∈{legalitas,company_letters,other}, `source_record_id uuid`(NOT NULL, soft pointer). `archive_reason`∈{Superseded,Expired,Withdrawn,Other}(nullable); `access_scope`∈{hrga_only,all_roles}.
- **tax_operational_records** (010:20) — REQ `tax_operational_record_number`(UNIQUE), `tax_type`∈{PPh 21,PPh 25,PPN,Others}, `tax_category`∈{SSP Payment,SPT Reporting,Combined Record}, `npwp`. `payment_status`∈{Unpaid,Paid,Pending,Failed}; `record_status`∈{Draft,Submitted,Verified,Archived}. `masa_pajak date`, `masa_pajak_month`(1–12), `masa_pajak_year`,`tahun_pajak` int; `amount`. `pic_user_id` FK.
- **tax_operational_audit_log** (010:89) — REQ **`record_id`(NOT NULL→tax_operational_records CASCADE)**, `action`∈{created,updated,status_changed,archived}. `changed_fields jsonb` default; `actor_user_id`,`actor_role`.
- **activity_logs** (015:19) — REQ `user_email`, `user_role`, `action`(free text). Nullable `user_id`, `resource_type`, `resource_id`(text), `detail jsonb`, `ip_address`, `user_agent`, `created_at`(settable). Action convention values incl: `auth.login.success`, `logout`, `created`, `edit`, `archived`, `export`, plus the domain ones.
- **chat_channels** (011:93) — REQ `channel_type`∈{role,dm,group,topic}. `channel_name`,`topic` nullable; `created_by`.
- **chat_channel_members** (011:136) — REQ `channel_id`(→chat_channels), `user_id`(→users). UNIQUE(channel_id,user_id).
- **chat_messages** (011:121) — REQ `channel_id`(→chat_channels CASCADE), `content`. `sender_user_id`,`topic_id` nullable; `created_at` settable.
- **chat_message_reads** (011:149) — REQ `message_id`(→chat_messages), `user_id`. UNIQUE(message_id,user_id).
- **users** (001:16) — REQ `email`(UNIQUE), `password_hash`(bcrypt cost 10), `role`(FK roles.role_key ∈ {superadmin,ceo,sales,admin_log,finance,technical,hrga,tax_insurance}), `display_name`. `account_status` default 'active' ∈{active,inactive,suspended}. `level_id` nullable. Seed pattern: `INSERT (email,password_hash,backup_password_hash,role,display_name,account_status) VALUES ($1,$2,$2,$3,$4,'active')` then set `level_id` via `SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id WHERE r.role_key=$role AND rl.level_rank=1`.

---

## Task 1: Migration 033 — `users.last_login_at`

**Files:** Create `backend/migrations/033_users_last_login.sql`; Test `backend/test/migrations/033_users_last_login.test.js`.

- [ ] **Step 1: failing test**
```javascript
'use strict';
const { pool } = require('../helpers/db');
describe('migration 033 users.last_login_at', () => {
  it('adds nullable timestamptz last_login_at', async () => {
    const r = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name='users' AND column_name='last_login_at'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toBe('timestamp with time zone');
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});
```
- [ ] **Step 2:** `npx vitest run test/migrations/033_users_last_login.test.js` → FAIL.
- [ ] **Step 3: migration**
```sql
-- Migration 033: users.last_login_at (D1 — for last-login display, item 11)
-- +migrate Up
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
COMMIT;
-- +migrate Down
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
COMMIT;
```
- [ ] **Step 4:** `node scripts/migrate.js && npx vitest run test/migrations/033_users_last_login.test.js` → applied + PASS.
- [ ] **Step 5: commit**
```bash
git add apps/interlabs-crm-demo/backend/migrations/033_users_last_login.sql apps/interlabs-crm-demo/backend/test/migrations/033_users_last_login.test.js
git commit -m "feat(d1): add users.last_login_at"
```

---

## Task 2: Refactor seeder into `scripts/seed-dummy/` package

Move the existing single-file seeder into a package WITHOUT behavior change, so domain modules can be added cleanly.

**Files:**
- Create dir `backend/scripts/seed-dummy/` with: `index.js`, `lib.js`, `po.js`.
- Move `backend/scripts/seed-dummy.lib.js` → `backend/scripts/seed-dummy/lib.js` (unchanged exports).
- Delete `backend/scripts/seed-dummy.js`; its logic splits into `index.js` (main/manifest/seedAll-orchestration/teardown) + `po.js` (`seedCustomers`, `pickActor`, `seedDocuments`, `seedAttachment`, `seedNotifications`, the PO loop, `CODE`, `nextSeq`).
- Modify `backend/test/scripts/seed-dummy.integration.test.js`: `SCRIPT` path → `'../../scripts/seed-dummy/index.js'`.
- Modify `backend/test/scripts/seed-dummy.lib.test.js`: require path → `'../../scripts/seed-dummy/lib'`.
- Modify `backend/.gitignore`: manifest line → `scripts/seed-dummy/.manifest.json`.

- [ ] **Step 1:** Create `seed-dummy/index.js` exporting an orchestrator. It keeps `MANIFEST = path.join(__dirname, '.manifest.json')`, `PO_NAMESPACE`, `YEAR`, `TOTAL=Number(process.env.SEED_DUMMY_COUNT||120)`, `loadManifest/saveManifest`, `main()`. `seedAll(manifest)` calls `require('./po').seedPoFlow(manifest, ctxConsts)` (the moved PO loop). `teardown(manifest)` keeps the existing S3 + DB-delete logic (PO/doc/attachment/notification/quotation/customer). Export nothing else; `main().catch(...)` at bottom. Pass shared constants (`YEAR`, `PO_NAMESPACE`, `db`, `minio`, `NO_FILES`, `L`) into modules via a small `ctx` object or by each module requiring `./lib` + `../../src/config/*` directly (prefer the latter — modules require their own deps; `index` only orchestrates + owns the manifest).
- [ ] **Step 2:** Create `seed-dummy/po.js` exporting `async function seedPoFlow(manifest)` containing the moved customer+PO+docs+attachments+notifications logic (verbatim from current `seed-dummy.js`, minus the manifest/CLI bits which stay in index). It requires `./lib`, `../../src/config/database`, `../../src/config/minio`, `../../src/services/po.service`, `crypto`. Keep `NO_FILES`, `CODE`, `nextSeq`, `YEAR`, `PO_NAMESPACE` here (or import from a shared consts — simplest: re-declare `YEAR=2026`, `PO_NAMESPACE='PO-DEMO'`, `NO_FILES` in po.js).
- [ ] **Step 3:** Update the two test require/SCRIPT paths + the `.gitignore` manifest path. Delete old `seed-dummy.js` and `seed-dummy.lib.js`.
- [ ] **Step 4:** Run BOTH existing tests — they must still pass unchanged:
  `npx vitest run test/scripts/seed-dummy.lib.test.js test/scripts/seed-dummy.integration.test.js` → all green (8 + 5).
- [ ] **Step 5: commit**
```bash
git add -A apps/interlabs-crm-demo/backend/scripts apps/interlabs-crm-demo/backend/test/scripts apps/interlabs-crm-demo/backend/.gitignore
git commit -m "refactor(d1): split dummy seeder into scripts/seed-dummy/ package (no behavior change)"
```

---

## Task 3: `spreadStatuses` helper

**Files:** Modify `backend/scripts/seed-dummy/lib.js`; Test `backend/test/scripts/seed-dummy.lib.test.js` (append).

- [ ] **Step 1: failing test** (append inside describe)
```javascript
  it('spreadStatuses guarantees >=1 of each value and length n', () => {
    const out = L.spreadStatuses(['a','b','c'], 7);
    expect(out).toHaveLength(7);
    for (const v of ['a','b','c']) expect(out.filter(x => x===v).length).toBeGreaterThanOrEqual(1);
  });
  it('spreadStatuses pads n up to values.length when n is too small', () => {
    expect(L.spreadStatuses(['a','b','c','d'], 2)).toHaveLength(4); // never drops a value
  });
```
- [ ] **Step 2:** run lib test → new cases FAIL.
- [ ] **Step 3: implement** (add to lib.js + export)
```javascript
// Returns an array of length max(n, values.length) where every value appears >=1
// (first one-of-each, then round-robin to fill). Guarantees no status bucket is 0.
function spreadStatuses(values, n) {
  const out = [...values];
  let i = 0;
  while (out.length < n) { out.push(values[i % values.length]); i++; }
  return out;
}
```
- [ ] **Step 4:** run lib test → PASS.
- [ ] **Step 5: commit** `git commit -m "feat(d1): spreadStatuses helper for guaranteed status coverage"`

---

## Tasks 4–12: domain seeder modules

**Shared pattern for every module task:**
- Create `backend/scripts/seed-dummy/<module>.js` exporting `async function seed<Module>(manifest)`.
- It requires `./lib` (for `spreadStatuses`, `formatRecordNumber`), `../../src/config/database` (`db.withTransaction`, `db.pool`), and seeds its tables **in one `db.withTransaction`**, pushing created ids into `manifest.<key>` arrays (add the array to the manifest init in `index.js`).
- Use `spreadStatuses(VALUES, N)` per status column; record numbers `<PREFIX>-DEMO-<seq>` (unique). Backdate `created_at` over ~30–60 days. Reference existing seeded POs/customers from the manifest where an FK is needed.
- Wire the call into `index.js` `seedAll` (after `seedPoFlow`, since some link to POs) and extend `teardown` to delete the module's rows (by namespace/manifest ids) in FK-safe order.
- Append coverage assertions to `test/scripts/seed-dummy.integration.test.js`: for each owned status column, `SELECT status, count(*) GROUP BY status` returns a row for **every** allowed value.
- Commit per module.

> **Worked example (use as the template for all modules) — Task 9 HRGA is fully spelled out below; Tasks 4–8, 10–12 follow the identical shape using their appendix rows.**

### Task 4: `users.js` — 6 demo staff + last_login
- Insert 6 users (divisions `sales,admin_log,finance,technical,hrga,tax_insurance`): email `staff.<div>.demo@interlab-portal.com` (use `tax` short form `staff.tax.demo@` but role `tax_insurance`), `password_hash = bcrypt.hashSync(process.env.DEMO_PASSWORD||'Demo@22April2026!',10)` (require `bcryptjs` or the project's bcrypt — check `package.json`; use whatever `auth.service` uses), `display_name='<Div> Staff (Demo)'`, then set `level_id` via the rank-1 lookup query (appendix). Push ids to `manifest.demoUserIds`.
- Set `last_login_at` for ALL active users (real + demo) to staggered recent timestamps: `UPDATE users SET last_login_at = now() - (random()*interval '5 days') WHERE account_status='active'`. (Teardown nulls it for demo users only; leaving real users' last_login set is harmless but for cleanliness teardown may null all — see Task 13.)
- Assertion: 6 `*.demo@` users exist with non-null `level_id` + `last_login_at`; all active users have non-null `last_login_at`.
- Commit: `feat(d1): seed 6 demo staff users + users.last_login_at`.

### Task 5: `sales.js`
- **Vary existing** (UPDATE rows seeded by po.js): set `quotations.workflow_status` across {draft,submitted,revised,accepted,rejected} via `spreadStatuses` over the demo quotation ids; same for `sales_purchase_orders.workflow_status` over {draft,submitted,processed,overdue} and `step_status` {on_track,overdue}.
- **Seed** `sales_forecasts` (N≈18): cover `stage` (6) × `workflow_status` (3) via spreadStatuses on each + `step_status`; `estimated_value` varied IDR; `customer_id` from manifest customers.
- **Seed** `harga_pokok_penjualan` (N≈9): `workflow_status` {draft,submitted,approved}; cost/price/margin amounts.
- **Seed** `purchase_requests_sales` (N≈9): `workflow_status` {draft,submitted,copied_to_finance}.
- Assertions: each of the 4 columns has all values present.
- Commit: `feat(d1): seed/vary sales widgets (quotations, sales-PO, forecasts, HPP, sales PR)`.

### Task 6: `finance.js`
- **Seed** `po_customer_records` (N≈16): `workflow_status` {registered,active,invoiced,completed}; `related_po_id` from manifest POs; amounts.
- **Seed** `invoice_manufactures` (N≈12): `payment_status` {Unpaid,Paid} (Paid rows get `payment_date`+`payment_amount`); link `related_po_id`.
- **Ensure variety**: UPDATE a few demo `invoice_customers` to `invoice_status='Registered'` and a few demo `purchase_requisitions` to each of {Registered,Processed} so both values present.
- Assertions: po_customer_records covers 4 workflow values; invoice_manufactures has both payment_status; invoice_customers + purchase_requisitions each have both status values.
- Commit: `feat(d1): seed finance widgets (po_customer, invoice_manufacture) + status variety`.

### Task 7: `technical.js`
- **Seed** `technical_job_orders` (N≈24): cover `workflow_status`(4) × `job_type`(3) (every combo ≥1 → ≥12, do 24); `related_po_id` (NOT NULL) from manifest POs; `assigned_engineer_id` = the technical user.
- For job orders of type Installation → **seed** `installation_records` covering all of: `inspection_status`,`function_test_status`,`admin_log_response_status`,`workflow_phase`,`ready_to_deliver` (spreadStatuses each); PM → `pm_records` {scheduled,in_progress,completed}; Sparepart → `sparepart_records` {awaiting_awb,workshop_check,ready,dispatched} + `admin_log_response_status`.
- **Seed** `inspection_qc_records` (N≈12): `review_status`(3) × `final_submit_status`(2) + `defect_category`.
- **Ensure** `bast_records.workflow_status` covers {draft,submitted,sent_to_finance} (UPDATE some demo BAST rows; po.js made them sent_to_finance).
- Assertions: each listed column has all values present.
- Commit: `feat(d1): seed technical widgets (job orders, installations, PM, spareparts, QC) + BAST variety`.

### Task 8: `adminlog.js`
- **Ensure** `awb_records.current_awb_status` covers {Registered,Processed,Arrived} and `delivery_orders.current_do_status` covers {Registered,Arrived} — UPDATE/insert demo rows to fill missing values.
- **Seed** `admin_operational_records` (N≈18): `expense_status`(3) × `workflow_status`(3); `reporting_month` (NOT NULL) = first-of-month across last few months; `amount`,`expense_category`,`department` varied.
- Assertions: awb 3 values, do 2 values, operational both columns full.
- Commit: `feat(d1): seed admin&log operational + AWB/DO status variety`.

### Task 9 (WORKED EXAMPLE): `hrga.js`
**Files:** Create `backend/scripts/seed-dummy/hrga.js`; modify `index.js` (init `manifest.hrgaLegalIds=[]`, `manifest.hrgaLetterIds=[]`, `manifest.hrgaArchiveIds=[]`; call `await require('./hrga').seedHrga(manifest)` in `seedAll`; extend teardown); append assertions to integration test.

- [ ] **Step 1: failing assertions** (append in integration test describe)
```javascript
  it('HRGA legal docs cover every document_status and compliance_flag', async () => {
    const ds = await pool.query(`SELECT document_status, count(*)::int c FROM hrga_legal_documents
      WHERE legal_document_record_number LIKE 'LGL-DEMO-%' GROUP BY document_status`);
    expect(ds.rows.map(r=>r.document_status).sort()).toEqual(
      ['Active','Archived','Draft','Expired','Expiring Soon','Superseded']);
    const cf = await pool.query(`SELECT compliance_flag, count(*)::int c FROM hrga_legal_documents
      WHERE legal_document_record_number LIKE 'LGL-DEMO-%' GROUP BY compliance_flag`);
    expect(cf.rows.map(r=>r.compliance_flag).sort()).toEqual(
      ['expired','expiring_soon_30','expiring_soon_90','ok']);
  });
  it('HRGA company letters cover every letter_status', async () => {
    const r = await pool.query(`SELECT letter_status FROM company_letters
      WHERE letter_record_number LIKE 'LTR-DEMO-%' GROUP BY letter_status`);
    expect(r.rows.map(x=>x.letter_status).sort()).toEqual(
      ['Archived','Draft','Final','Sent','Under Review']);
  });
  it('HRGA archive covers every archive_reason', async () => {
    const r = await pool.query(`SELECT archive_reason FROM hrga_archive_records
      WHERE archive_record_number LIKE 'ARC-DEMO-%' GROUP BY archive_reason`);
    expect(r.rows.map(x=>x.archive_reason).sort()).toEqual(['Expired','Other','Superseded','Withdrawn']);
  });
```
- [ ] **Step 2:** run integration test → these 3 FAIL (no hrga data).
- [ ] **Step 3: implement `hrga.js`**
```javascript
'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);

const DOC_STATUS = ['Draft','Active','Expiring Soon','Expired','Superseded','Archived'];
const FLAG = ['ok','expiring_soon_90','expiring_soon_30','expired'];
const LETTER_STATUS = ['Draft','Under Review','Final','Sent','Archived'];
const ARCHIVE_REASON = ['Superseded','Expired','Withdrawn','Other'];

async function seedHrga(manifest) {
  await db.withTransaction(async (client) => {
    // Legal documents: cover doc_status x compliance_flag (>=1 each), N=18
    const docStatuses = L.spreadStatuses(DOC_STATUS, 18);
    const flags = L.spreadStatuses(FLAG, 18);
    for (let i = 0; i < 18; i++) {
      const flag = flags[i];
      // expiry_date consistent with the flag so Compliance/Renewals widgets render correctly
      const days = flag === 'expired' ? -30 : flag === 'expiring_soon_30' ? 20
        : flag === 'expiring_soon_90' ? 75 : 400;
      const r = await client.query(
        `INSERT INTO hrga_legal_documents
           (legal_document_record_number, document_name, document_status, compliance_flag,
            access_scope, expiry_date, created_at)
         VALUES ($1,$2,$3,$4,'hrga_only', (now() + ($5 || ' days')::interval)::date, now() - ($6 || ' days')::interval)
         RETURNING id`,
        [fmt('LGL', i + 1), `Izin/Legal Doc ${i + 1}`, docStatuses[i], flag, days, (i * 3)]);
      manifest.hrgaLegalIds.push(r.rows[0].id);
    }
    // Company letters: cover letter_status, N=12
    const letterStatuses = L.spreadStatuses(LETTER_STATUS, 12);
    for (let i = 0; i < 12; i++) {
      const r = await client.query(
        `INSERT INTO company_letters (letter_record_number, subject, letter_status, access_scope, created_at)
         VALUES ($1,$2,$3,'hrga_only', now() - ($4 || ' days')::interval) RETURNING id`,
        [fmt('LTR', i + 1), `Surat Resmi ${i + 1}`, letterStatuses[i], (i * 2)]);
      manifest.hrgaLetterIds.push(r.rows[0].id);
    }
    // Archive: cover archive_reason, N=8 (source_record_id points at a seeded legal doc)
    const reasons = L.spreadStatuses(ARCHIVE_REASON, 8);
    for (let i = 0; i < 8; i++) {
      const src = manifest.hrgaLegalIds[i % manifest.hrgaLegalIds.length];
      const r = await client.query(
        `INSERT INTO hrga_archive_records
           (archive_record_number, source_module, source_record_id, archive_reason, access_scope, created_at)
         VALUES ($1,'legalitas',$2,$3,'hrga_only', now() - ($4 || ' days')::interval) RETURNING id`,
        [fmt('ARC', i + 1), src, reasons[i], (i * 5)]);
      manifest.hrgaArchiveIds.push(r.rows[0].id);
    }
  });
}
module.exports = { seedHrga };
```
- [ ] **Step 4:** wire into `index.js` (init the 3 manifest arrays; `await require('./hrga').seedHrga(manifest)` in `seedAll`; in `teardown` add `DELETE FROM hrga_archive_records WHERE archive_record_number LIKE 'ARC-DEMO-%'; DELETE FROM company_letters WHERE letter_record_number LIKE 'LTR-DEMO-%'; DELETE FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%';`). Run integration test → 3 HRGA assertions PASS.
- [ ] **Step 5: commit** `feat(d1): seed HRGA legal docs, company letters, archive (all statuses)`

### Task 10: `tax.js`
- **Seed** `tax_operational_records` (N≈24): cover `tax_type`(4) × `payment_status`(4) × `record_status`(4) via spreadStatuses on each (N≥ max=4, use 24 for spread); REQ `tax_category` (spread {SSP Payment,SPT Reporting,Combined Record}) + `npwp` (dummy). Set `masa_pajak`/`masa_pajak_month`/`year` across recent months; `amount` varied.
- **Seed** `tax_operational_audit_log` (≥1 per seeded record): `action` covering {created,updated,status_changed,archived}; `record_id` from the seeded tax records.
- Assertions: tax_type/payment_status/record_status each fully covered; audit_log non-empty with all actions.
- Commit: `feat(d1): seed tax operational records + audit log (all tax types & statuses)`.

### Task 11: `activity.js`
- Seed `activity_logs` for ALL users (8 real + 6 demo): for each user emit several rows covering actions {auth.login.success, logout, created, edit, archived, export}, `resource_type`/`resource_id` referencing seeded records (PO numbers, quotation ids, etc.), `user_email`/`user_role` denormalized from the user, backdated `created_at` over ~30 days. Guarantee ≥1 per role and every action value present.
- Assertion: distinct `user_role` count ≥ 8; every action in the set present; `SELECT count(*) > 0`.
- Note: since activity_logs has no namespace column, track seeded ids in `manifest.activityLogIds` for teardown.
- Commit: `feat(d1): seed activity logs for all roles`.

### Task 12: `chat.js`
- Build DM threads (`channel_type='dm'`, 2 members each) + messages so: **≥80 messages total**, **each role ≥10** (counting messages in threads the role participates in), **superadmin & CEO each have a DM thread with every other role**, plus ≥1 intra-dept Manager↔Staff thread (real division user ↔ matching `*.demo` staff). Content = Bahasa Indonesia follow-ups referencing seeded PO/doc numbers; backdated; add some `chat_message_reads`. Use a pure helper in `lib.js` (`buildDmPlan(roleUsers)`) to enumerate the pairs guaranteeing coverage; unit-test the plan shape. Track channel/message ids in `manifest.chatChannelIds` (+ members/messages cascade or track ids) for teardown.
- Assertions: total messages ≥80; per-participant message count ≥10 for every role; superadmin & ceo each have ≥7 distinct DM partners.
- Commit: `feat(d1): seed >=80 1:1 chat bubbles across all roles (cross + intra dept)`.

---

## Task 13: Extend `--reset` teardown + idempotency

**Files:** Modify `backend/scripts/seed-dummy/index.js`; append to integration test.

- [ ] **Step 1: assertion** (append): after a double `run(['--reset'])`, every D1 namespace count equals exactly one batch (no duplication) and demo users count is exactly 6.
```javascript
  it('--reset fully removes D1 data (no duplication, demo users = 6)', async () => {
    run(['--reset']); run(['--reset']);
    const u = await pool.query(`SELECT count(*)::int c FROM users WHERE email LIKE 'staff.%.demo@%'`);
    expect(u.rows[0].c).toBe(6);
    const lgl = await pool.query(`SELECT count(*)::int c FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%'`);
    expect(lgl.rows[0].c).toBe(18);
  });
```
- [ ] **Step 2:** run → may already pass for tables whose teardown was added per-module; FAIL if demo users / activity / chat / new tables aren't torn down yet.
- [ ] **Step 3: implement** — ensure `teardown` deletes, in FK-safe order: chat_message_reads → chat_messages → chat_channel_members → chat_channels (demo channel ids); activity_logs (manifest ids); tax_operational_audit_log → tax_operational_records (`TAX-DEMO-%`); installation/pm/sparepart (CASCADE via technical_job_orders delete) → inspection_qc_records (`QC-DEMO-%`) → technical_job_orders (`*-DEMO-%`, but note RESTRICT on PO is fine since we delete job orders before POs in the existing PO teardown — ensure ORDER: technical before PO delete); admin_operational_records (`*-DEMO-%`); hrga (already added Task 9); finance (po_customer `*-DEMO-%`, invoice_manufacture `*-DEMO-%`); sales (forecasts/hpp/sales-PR `*-DEMO-%`; the quotation/sales-PO variety was UPDATEs on po.js rows, removed when those are deleted); demo users (`email LIKE 'staff.%.demo@%'`) LAST (after anything FK-referencing them, e.g. chat members, activity_logs.user_id — delete those first or rely on SET NULL/CASCADE per FK). NULL `last_login_at` for all (or leave — harmless). Then existing PO teardown. Clear manifest.
- [ ] **Step 4:** run full integration test → all PASS; double-reset shows no duplication.
- [ ] **Step 5: commit** `feat(d1): extend --reset teardown for all D1 data (idempotent)`

---

## Task 14: Live verification (manual, gated)

- [ ] Rebuild + restart api (applies migration 033): `docker compose build interlab-api && docker compose up -d interlab-api`, wait for `listening`.
- [ ] `docker exec interlab-api node scripts/seed-dummy/index.js --reset`
- [ ] Verification script: for each entity, print `GROUP BY <status>` counts and assert no zero buckets; print chat total + per-role counts + activity role coverage. (Run via `docker exec interlab-api node -e '…'`.)
- [ ] **STOP — user logs in per role** (Sales/Finance/Technical/Admin&Log/HRGA/Tax/Superadmin) and confirms every widget is populated + varied. Only after confirmation: push + MR to main.

---

## Self-review notes (author)
- **Spec coverage:** §3 migration → T1; §2 modular refactor → T2; §2.2 spreadStatuses → T3; §4 demo users + last_login → T4; §5.1 Sales → T5; §5.2 Finance → T6; §5.3 Technical → T7; §5.4 Admin&Log → T8; §5.5 HRGA → T9; §5.6 Tax → T10; §6 activity → T11; §8 chat → T12; §9 teardown → T13; §11 live verify → T14. ✓
- **Coverage rule** enforced by per-module `GROUP BY status` assertions (every allowed value present).
- **FK order** in teardown: technical_job_orders deleted before POs (RESTRICT); chat/activity/members before demo users; CASCADE handles installation/pm/sparepart + chat children.
- **Naming consistency:** `spreadStatuses`, `seedPoFlow`, `seed<Module>`, manifest arrays (`demoUserIds`, `hrgaLegalIds`, …) used consistently.
- **No new domain tables** (REUSE); only migration 033.

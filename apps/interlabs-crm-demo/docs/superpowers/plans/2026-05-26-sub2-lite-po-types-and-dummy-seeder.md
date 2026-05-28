# PO Types, Multi-termin Billing & Dummy Data Seeder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every role's dashboard, PO tracking, notifications, and billing views come alive by adding minimal additive PO-type support + multi-termin billing, then seeding ~100 realistic, linked Purchase Orders (with S3 attachments and backdated history) on the staging stack.

**Architecture:** Two small additive migrations (`po_type` on `purchase_orders`; payment/termin columns on `invoice_customers`) + a type-aware generalization of the existing forward-only PO state machine (`po.service.js`), then a standalone, manifest-resettable `scripts/seed-dummy.js`. The seeder writes directly to Postgres (backdated history/tracking + linked documents + multi-termin invoices + dept-scoped historical notifications) and uploads real objects to minio-global, so dashboards/tracking/presigned-view all function without firing live notifications/emails.

**Tech Stack:** Node 20 (CommonJS), `pg` (raw SQL, numbered migrations via `scripts/migrate.js`), MinIO client (`src/config/minio.js`), vitest (against `crmdemo_test`). Spec: `docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md`.

---

## Conventions (read once)

- **Run tests** from `backend/` with node on PATH and the test DB URL:
  ```bash
  export PATH="/home/zaky/.nvm/versions/node/v20.20.2/bin:$PATH"
  PW=$(sudo grep -E "^interlab_staging01_password=" /root/.coolify-secrets-backup.txt | cut -d= -f2-)
  export DATABASE_URL="postgresql://interlab_staging01:${PW}@127.0.0.1:5440/crmdemo_test"
  npx vitest run <path>
  ```
  (`test/setup.js` rewrites the dbname to `crmdemo_test`.) Pre-existing env failures unrelated to this work: redis/avatar/notification_dispatch/permission — ignore them; only judge the files this plan touches.
- **Migration format:** `-- +migrate Up` / `BEGIN; … COMMIT;` / `-- +migrate Down` / `BEGIN; … COMMIT;`. Idempotent DDL (`IF NOT EXISTS`). Latest existing migration is `030`.
- **Status case gotcha:** `purchase_orders.current_status` is **Title-case** (`'Registered'`…`'Invoice'`); `purchase_order_status_history.status_code` is **UPPERCASE** (`'REGISTERED'`…). Use `STATUS_CODE[name]` for the latter.
- **Commit after each task.** Never commit unrelated files. Do NOT push (user pushes manually).

## Schema appendix (INSERT-ready — required = NOT NULL & no default)

Every form table also has auto `id uuid DEFAULT gen_random_uuid()`, `created_at/updated_at DEFAULT now()`, nullable `deleted_at`, nullable `created_by/updated_by` (FK users). All `*_record_number` columns are `text NOT NULL UNIQUE`.

- `customers` (`004:10`) — req: `customer_record_number`, `company_name`. Useful: `trade_name,address,city,country,phone,email,npwp,pic_name,pic_phone,pic_email`, `customer_status` default `'Active'`.
- `purchase_orders` (`003:24`) — req: `po_number`. Cols: `current_status` (Title-case CHECK), `created_by_user_id/role`, `updated_by_user_id/role`, `customer_id` FK, `due_at`, `overdue_at`, + **NEW** `po_type` (Task 1).
- `purchase_order_status_history` (`003:53`) — req: `po_id`, `po_number`, `status_code` (UPPERCASE CHECK), `status_label`. Cols: `updated_by_user_id/role`, `note`, `reason_if_delayed`, `attachment_url`, `is_rejection`, `reject_count_after`, `is_admin_override`, `created_at`. (no updated_at/deleted_at)
- `purchase_order_tracking_events` (`003:76`) — req: `po_id`, `event_type`. Col: `payload_json jsonb DEFAULT '{}'`. (no updated_at/deleted_at)
- `quotations` (`005:69`) — req: `quotation_record_number`. Cols: `customer_id`, `quotation_date`, `validity_date`, `currency` def `'IDR'`, `item_list jsonb def '[]'`, `subtotal,tax_amount,total_amount numeric(20,2)`, `workflow_status` def `'draft'` CHECK(draft,submitted,revised,accepted,rejected).
- `sales_purchase_orders` (`005:143`) — req: `po_record_number`. Cols: `po_number`, `customer_id`, `related_quotation_id` FK quotations, `order_date`, `delivery_deadline`, `item_list`, `subtotal,tax_amount,total_amount`, `po_id` FK purchase_orders, `workflow_status` def `'draft'` CHECK(draft,submitted,processed,overdue).
- `purchase_requisitions` (finance PR, `007:59`) — req: `pr_record_number`. Cols: `related_po_id` FK purchase_orders, `customer_id`, `supplier_or_manufacturer`, `manufacturer_contact_person`, `pr_date`, `item_list`, `payment_term` (singular), `current_pr_status` def `'Registered'` CHECK(Registered,Processed).
- `awb_records` (`006:18`) — req: `awb_record_number`, **`related_po_id` (NOT NULL, RESTRICT)**. Cols: `related_po_number`, `customer_id`, `forwarder_or_courier`, `awb_tracking_number`, `shipment_method` CHECK(Air,Sea,Land,Courier), `origin_country`, `destination`, `despatch_date`, `arrival_date`, `current_awb_status` def `'Registered'` CHECK(Registered,Processed,Arrived).
- `delivery_orders` (`006:69`) — req: `do_record_number`, **`related_po_id` (NOT NULL, RESTRICT)**. Cols: `related_po_number`, `customer_id`, `delivery_order_number`, `delivery_date`, `shipping_method`, `courier_or_expedition_vendor`, `delivery_address`, `item_list`, `current_do_status` def `'Registered'` CHECK(Registered,Arrived).
- `bast_records` (`008:206`) — req: `bast_record_number`. Cols: `related_po_id` FK, `customer_id`, `job_type` CHECK(Installation,PM,Sparepart), `completion_start_date`, `completion_end_date`, `scope_summary`, `customer_pic`, `technical_pic_id` FK users, `sent_to_finance` def false, `workflow_status` def `'draft'` CHECK(draft,submitted,sent_to_finance).
- `invoice_customers` (`007:137`) — req: `invoice_customer_record_number`. Cols: `related_bast_id`, `related_do_id`, `related_po_id` FK, `customer_id`, `invoice_number`, `invoice_date`, `currency`, `item_list`, `subtotal,vat_amount,total_amount`, `payment_due_date`, `invoice_status` def `'Registered'` CHECK(Registered,Processed), + **NEW** termin/payment cols (Task 2).
- `file_attachments` (`012:20`) — req: `original_filename`, `mime_type`, `related_module`, `storage_bucket`, `storage_path`. UNIQUE(`storage_bucket`,`storage_path`). Cols: `extension`, `uploaded_by`, `related_entity_id`, `size_bytes`, nullable `po_document_type_id` (from 022 — omit).
- `notifications` (`011:21`) — req: `title` + **at least one of** (`recipient_user_id`, `recipient_role`). Cols: `message`, `sender_user_id`, `related_module`, `related_entity_type`, `related_entity_id`, **`is_read` boolean def false** (NOT `read_at`). (no updated_at/deleted_at)

**Helpers / config:**
- `src/config/database.js` → `{ pool, query, withTransaction }`. `withTransaction(async client => …)` does BEGIN/COMMIT/ROLLBACK.
- `src/config/minio.js` → `{ getClient, getPublicClient, bucketAttachments, bucketAvatars }`. `getClient().putObject(bucket, key, buffer, size, { 'Content-Type': mime })`.
- Record numbers: format string is `` `${PREFIX}-${year}-${String(seq).padStart(5,'0')}` ``. For bulk seeding, hand-format (don't use `nextRecordNumber`, which needs a tx + advisory lock). Prefixes: `CUST, QT, PO, PR, AWB, DO, BAST` and use `INV` for customer invoices.
- `po.service.js` constants: `STATUS_ORDER`, `STATUS_CODE`, `STATUS_TEMPLATE`, `STATUS_DEFAULT_RECIPIENTS` (all keyed by Title-case status name).

---

## Task 1: Migration 031 — `purchase_orders.po_type`

**Files:**
- Create: `backend/migrations/031_po_type.sql`
- Test: `backend/test/migrations/031_po_type.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { pool } = require('../helpers/db');

describe('migration 031 po_type', () => {
  it('purchase_orders has po_type text NOT NULL default installation', async () => {
    const r = await pool.query(`
      SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name = 'purchase_orders' AND column_name = 'po_type'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toBe('text');
    expect(r.rows[0].is_nullable).toBe('NO');
    expect(r.rows[0].column_default).toMatch(/installation/);
  });

  it('rejects an unknown po_type via the CHECK constraint', async () => {
    await expect(pool.query(
      `INSERT INTO purchase_orders (po_number, po_type) VALUES ('PO-CHK-TEST-1','bogus')`,
    )).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/migrations/031_po_type.test.js`
Expected: FAIL (`rowCount` 0 — column does not exist yet).

- [ ] **Step 3: Write the migration**

```sql
-- ============================================================================
-- Migration 031: po_type on purchase_orders (Sub-2-lite)
-- service | supply | installation. Default 'installation' = the existing full
-- 11-stage path, so legacy rows + behavior are unchanged.
-- Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md §2.1
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS po_type text NOT NULL DEFAULT 'installation';
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_po_type_chk;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_po_type_chk
  CHECK (po_type IN ('service','supply','installation'));
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_type_chk;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS po_type;
COMMIT;
```

- [ ] **Step 4: Apply migration + run test**

Run:
```bash
node scripts/migrate.js
npx vitest run test/migrations/031_po_type.test.js
```
Expected: migrate prints `031_po_type.sql` applied; both tests PASS. (Clean up the CHK-test row if it committed: it won't — the INSERT throws and rolls back its own implicit tx.)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/031_po_type.sql backend/test/migrations/031_po_type.test.js
git commit -m "feat(sub-2-lite): add purchase_orders.po_type (service/supply/installation)"
```

---

## Task 2: Migration 032 — multi-termin billing on `invoice_customers`

**Files:**
- Create: `backend/migrations/032_invoice_customer_payments.sql`
- Test: `backend/test/migrations/032_invoice_customer_payments.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { pool } = require('../helpers/db');

describe('migration 032 invoice_customers payment/termin columns', () => {
  const cols = ['termin_sequence','termin_label','amount','due_date','payment_status','paid_at','payment_method'];
  it('adds all termin/payment columns', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='invoice_customers' AND column_name = ANY($1)`, [cols]);
    expect(r.rows.map(x => x.column_name).sort()).toEqual([...cols].sort());
  });
  it('payment_status defaults to pending and rejects unknown values', async () => {
    const def = await pool.query(`
      SELECT column_default FROM information_schema.columns
       WHERE table_name='invoice_customers' AND column_name='payment_status'`);
    expect(def.rows[0].column_default).toMatch(/pending/);
    await expect(pool.query(
      `INSERT INTO invoice_customers (invoice_customer_record_number, payment_status)
       VALUES ('INV-CHK-TEST-1','bogus')`,
    )).rejects.toThrow();
  });
  it('allows multiple invoice_customers rows for the same PO', async () => {
    const po = await pool.query(
      `INSERT INTO purchase_orders (po_number) VALUES ('PO-MULTI-INV-1') RETURNING id`);
    const poId = po.rows[0].id;
    await pool.query(
      `INSERT INTO invoice_customers (invoice_customer_record_number, related_po_id, termin_sequence)
       VALUES ('INV-MULTI-1', $1, 1), ('INV-MULTI-2', $1, 2)`, [poId]);
    const n = await pool.query(
      `SELECT count(*)::int c FROM invoice_customers WHERE related_po_id=$1`, [poId]);
    expect(n.rows[0].c).toBe(2);
    // cleanup
    await pool.query(`DELETE FROM invoice_customers WHERE related_po_id=$1`, [poId]);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [poId]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/migrations/032_invoice_customer_payments.test.js`
Expected: FAIL (columns missing).

- [ ] **Step 3: Write the migration**

```sql
-- ============================================================================
-- Migration 032: multi-termin billing on invoice_customers (Sub-2-lite)
-- Each invoice_customers row = one termin (DP/Termin/Pelunasan/Full) for its PO.
-- Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md §2.1
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS termin_sequence integer;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS termin_label text;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS amount numeric(20,2);
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_payment_status_chk;
ALTER TABLE invoice_customers ADD CONSTRAINT invoice_customers_payment_status_chk
  CHECK (payment_status IN ('pending','paid'));
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_termin_label_chk;
ALTER TABLE invoice_customers ADD CONSTRAINT invoice_customers_termin_label_chk
  CHECK (termin_label IS NULL OR termin_label IN ('DP','Termin','Pelunasan','Full'));
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_payment_status_chk;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_termin_label_chk;
ALTER TABLE invoice_customers
  DROP COLUMN IF EXISTS termin_sequence, DROP COLUMN IF EXISTS termin_label,
  DROP COLUMN IF EXISTS amount, DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS payment_status, DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS payment_method;
COMMIT;
```

> Note: the existing `invoice_customers` has no UNIQUE on `related_po_id`, so N rows per PO already works; the test confirms it.

- [ ] **Step 4: Apply + run test**

Run: `node scripts/migrate.js && npx vitest run test/migrations/032_invoice_customer_payments.test.js`
Expected: applied; all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/032_invoice_customer_payments.sql backend/test/migrations/032_invoice_customer_payments.test.js
git commit -m "feat(sub-2-lite): multi-termin payment columns on invoice_customers"
```

---

## Task 3: Type-aware PO state machine (`po.service.js`)

**Files:**
- Modify: `backend/src/services/po.service.js` (add `PATH_BY_TYPE`/`pathFor`/`assertOnPath` near `STATUS_ORDER:32`; use them in `advanceStatus:411-426`; export the new helpers)
- Test: `backend/test/services/po.types.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const po = require('../../src/services/po.service');
const { pool } = require('../helpers/db');

describe('po.service per-type paths', () => {
  it('pathFor returns the service subsequence', () => {
    expect(po.pathFor('service')).toEqual(['Registered','Processed','Inspected','BAST','Invoice']);
  });
  it('pathFor falls back to the full 11-stage path for unknown/installation', () => {
    expect(po.pathFor('installation')).toHaveLength(11);
    expect(po.pathFor(undefined)).toHaveLength(11);
  });
  it('assertOnPath rejects an off-path stage for service (Production)', () => {
    expect(() => po.assertOnPath('service','Processed','Production')).toThrow(/not on the service path/i);
  });
  it('assertOnPath rejects backward motion', () => {
    expect(() => po.assertOnPath('supply','Arrived','Processed')).toThrow(/back to/i);
  });
  it('assertOnPath allows a valid forward step on the supply path', () => {
    expect(() => po.assertOnPath('supply','Arrived','Inspected')).not.toThrow();
  });

  it('advanceStatus rejects advancing a service PO into Production', async () => {
    const u = await pool.query(`SELECT id, role FROM users WHERE role='sales' AND deleted_at IS NULL LIMIT 1`);
    const actor = u.rows[0];
    const ins = await pool.query(
      `INSERT INTO purchase_orders (po_number, po_type, current_status)
       VALUES ('PO-TYPE-TEST-SVC-1','service','Processed') RETURNING id`);
    const poId = ins.rows[0].id;
    await expect(po.advanceStatus(null, {
      poId, newStatus: 'Production', actorUserId: actor.id, actorRole: actor.role,
    })).rejects.toThrow(/not on the service path/i);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [poId]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/services/po.types.test.js`
Expected: FAIL (`po.pathFor is not a function`).

- [ ] **Step 3: Add the path helpers** (insert immediately after `STATUS_ORDER` block, ~line 35)

```javascript
// Per-type lifecycle paths (Sub-2-lite). Each is an ordered SUBSEQUENCE of
// STATUS_ORDER, so forward-only motion is preserved. Unknown/installation =
// the full path → legacy behavior unchanged.
const PATH_BY_TYPE = Object.freeze({
    service: ['Registered', 'Processed', 'Inspected', 'BAST', 'Invoice'],
    supply: ['Registered', 'Processed', 'Production', 'Shipped', 'Customs',
        'Arrived', 'Inspected', 'Delivery', 'Invoice'],
    installation: STATUS_ORDER,
});

function pathFor(poType) {
    return PATH_BY_TYPE[poType] || STATUS_ORDER;
}

// Throws if newStatus is not on poType's path, or is a backward move.
// Pure (no I/O) so it is unit-testable; advanceStatus delegates to it.
function assertOnPath(poType, currentStatus, newStatus) {
    const path = pathFor(poType);
    if (!path.includes(newStatus)) {
        throw new BadRequestError(
            `Status '${newStatus}' is not on the ${poType || 'installation'} path`,
        );
    }
    if (path.indexOf(newStatus) < path.indexOf(currentStatus)) {
        throw new BadRequestError(
            `Cannot move PO back to '${newStatus}' from '${currentStatus}'`,
        );
    }
}
```

- [ ] **Step 4: Use it in `advanceStatus`** — replace the backward-only guard at lines ~421-426:

```javascript
        if (po.current_status === newStatus) return po;
        assertOnPath(po.po_type, po.current_status, newStatus);
```

(Removes the old `statusIndex(newStatus) < statusIndex(po.current_status)` block; keep `isValidStatus(newStatus)` above it.)

- [ ] **Step 5: Export the new helpers** — add `pathFor` and `assertOnPath` to the existing `module.exports = { … }` at the bottom of the file.

- [ ] **Step 6: Run the new test + the existing PO suite**

Run:
```bash
npx vitest run test/services/po.types.test.js
npx vitest run test/services/po.service.test.js test/routes
```
Expected: new tests PASS; existing PO/route tests still PASS (installation path == old behavior).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/po.service.js backend/test/services/po.types.test.js
git commit -m "feat(sub-2-lite): type-aware PO lifecycle paths (service/supply/installation)"
```

---

## Task 4: Seeder scaffold + pure helpers — `scripts/seed-dummy.js`

**Files:**
- Create: `backend/scripts/seed-dummy.js`
- Create: `backend/scripts/seed-dummy.lib.js` (pure, testable helpers)
- Test: `backend/test/scripts/seed-dummy.lib.test.js`

- [ ] **Step 1: Write the failing test for the pure helpers**

```javascript
'use strict';
const L = require('../../scripts/seed-dummy.lib');
const po = require('../../src/services/po.service');

describe('seed-dummy.lib', () => {
  it('planTypeDistribution(100) → 40 installation / 30 supply / 30 service', () => {
    const d = L.planTypeDistribution(100);
    expect(d).toHaveLength(100);
    const c = d.reduce((a, t) => (a[t] = (a[t]||0)+1, a), {});
    expect(c).toEqual({ installation: 40, supply: 30, service: 30 });
  });

  it('formatRecordNumber zero-pads to PREFIX-YYYY-NNNNN', () => {
    expect(L.formatRecordNumber('PO', 2026, 42)).toBe('PO-2026-00042');
  });

  it('terminPlanFor(installation) → DP 40% + Pelunasan 60% summing to total', () => {
    const p = L.terminPlanFor('installation', 100_000_000);
    expect(p.map(t => t.label)).toEqual(['DP', 'Pelunasan']);
    expect(p.reduce((s, t) => s + t.amount, 0)).toBe(100_000_000);
    expect(p[0].amount).toBe(40_000_000);
  });

  it('terminPlanFor(supply) → single Full termin = total', () => {
    const p = L.terminPlanFor('supply', 50_000_000);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ label: 'Full', amount: 50_000_000 });
  });

  it('buildTimeline backdates one entry per stage up to the target, oldest first', () => {
    const path = po.pathFor('service'); // Registered,Processed,Inspected,BAST,Invoice
    const tl = L.buildTimeline(path, 'BAST', new Date('2026-01-01T00:00:00Z'));
    expect(tl.map(e => e.status)).toEqual(['Registered','Processed','Inspected','BAST']);
    for (let i = 1; i < tl.length; i++) {
      expect(tl[i].at.getTime()).toBeGreaterThan(tl[i-1].at.getTime());
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/scripts/seed-dummy.lib.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the pure helpers**

```javascript
'use strict';
// Pure, side-effect-free helpers for the dummy seeder (unit-testable).
const PALETTE = { installation: 0.40, supply: 0.30, service: 0.30 };

function planTypeDistribution(total) {
    const out = [];
    for (const [type, frac] of Object.entries(PALETTE)) {
        for (let i = 0; i < Math.round(total * frac); i++) out.push(type);
    }
    while (out.length < total) out.push('installation');
    return out.slice(0, total);
}

function formatRecordNumber(prefix, year, seq) {
    return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// Termin pattern per type (amounts sum exactly to total; last absorbs rounding).
function terminPlanFor(poType, total) {
    const mk = (parts) => {
        let acc = 0;
        return parts.map(([label, pct], i) => {
            const amount = i === parts.length - 1
                ? total - acc
                : Math.round(total * pct);
            acc += amount;
            return { label, amount, sequence: i + 1 };
        });
    };
    if (poType === 'installation') return mk([['DP', 0.4], ['Pelunasan', 0.6]]);
    return mk([['Full', 1]]); // supply/service: single termin by default
}

// One backdated entry per stage from path[0] up to and including targetStage.
function buildTimeline(path, targetStage, startDate) {
    const end = path.indexOf(targetStage);
    const stages = path.slice(0, end + 1);
    const stepMs = 5 * 24 * 60 * 60 * 1000; // ~5 days between stages
    return stages.map((status, i) => ({
        status,
        at: new Date(startDate.getTime() + i * stepMs),
    }));
}

module.exports = { planTypeDistribution, formatRecordNumber, terminPlanFor, buildTimeline, PALETTE };
```

- [ ] **Step 4: Write the scaffold** `scripts/seed-dummy.js` (orchestration shell; data steps land in Tasks 5–8)

```javascript
'use strict';
// Manual dummy-data seeder. NOT wired into entrypoint.sh. Run on demand:
//   node scripts/seed-dummy.js            # seed (refuses if a batch exists)
//   node scripts/seed-dummy.js --reset    # tear down prior batch + S3 objects, then reseed
// Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const L = require('./seed-dummy.lib');

const MANIFEST = path.join(__dirname, '.seed-dummy-manifest.json');
const PO_NAMESPACE = 'PO-DEMO'; // secondary marker if manifest is lost
const YEAR = 2026;
const TOTAL = Number(process.env.SEED_DUMMY_COUNT || 100);

function loadManifest() {
    if (!fs.existsSync(MANIFEST)) return null;
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
function saveManifest(m) { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }

async function main() {
    const reset = process.argv.includes('--reset');
    const existing = loadManifest();
    if (existing && !reset) {
        throw new Error(`A dummy batch already exists (${existing.poIds.length} POs). Re-run with --reset.`);
    }
    if (reset) await teardown(existing); // Task 8

    const manifest = { createdAt: new Date().toISOString(), poIds: [], customerIds: [], s3Keys: [] };
    await seedAll(manifest); // Tasks 5–7
    saveManifest(manifest);
    console.log(`[seed-dummy] done: ${manifest.poIds.length} POs, ${manifest.s3Keys.length} S3 objects.`);
    await db.pool.end();
}

async function seedAll(_manifest) { throw new Error('seedAll: implemented in Tasks 5–7'); }
async function teardown(_manifest) { throw new Error('teardown: implemented in Task 8'); }

main().catch((e) => { console.error('[seed-dummy] FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 5: Run helper test + a smoke run**

Run:
```bash
npx vitest run test/scripts/seed-dummy.lib.test.js   # PASS
node scripts/seed-dummy.js 2>&1 | tail -2             # expect: FAILED: seedAll: implemented in Tasks 5–7
```
Expected: helper tests PASS; the script reaches `seedAll` stub (proves wiring/manifest guard work).

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/seed-dummy.js backend/scripts/seed-dummy.lib.js backend/test/scripts/seed-dummy.lib.test.js
echo "scripts/.seed-dummy-manifest.json" >> backend/.gitignore
git add backend/.gitignore
git commit -m "feat(sub-4): dummy seeder scaffold + pure helpers (distribution, termin, timeline)"
```

---

## Task 5: Seed customers + typed POs + backdated history/tracking

**Files:**
- Modify: `backend/scripts/seed-dummy.js` (implement `seedAll` part 1 + a `seedActors`/customer helper)
- Test: `backend/test/scripts/seed-dummy.integration.test.js`

This task implements direct DB writes (NOT `advanceStatus`) so timestamps can be backdated and no notifications fire. Each PO gets: a `purchase_orders` row (with `po_type`, final `current_status` = target stage), and one `status_history` + `tracking_events` row per stage in its backdated timeline.

- [ ] **Step 1: Write the failing integration test** (small N, DB-only)

```javascript
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { pool } = require('../helpers/db');

const SCRIPT = path.join(__dirname, '../../scripts/seed-dummy.js');
const run = (args = []) => execFileSync('node', [SCRIPT, ...args], {
  env: { ...process.env, SEED_DUMMY_COUNT: '12', SEED_DUMMY_NO_FILES: '1' },
  cwd: path.join(__dirname, '../..'),
});

describe('seed-dummy integration (DB-only, N=12)', () => {
  beforeAll(() => { run(['--reset']); });          // idempotent fresh seed
  afterAll(async () => { run(['--reset']); });      // leave DB clean (reset then reseed 12 — see Task 8 note)

  it('creates 12 demo POs across all three types', async () => {
    const r = await pool.query(
      `SELECT po_type, count(*)::int c FROM purchase_orders
        WHERE po_number LIKE 'PO-DEMO-%' GROUP BY po_type`);
    const byType = r.rows.reduce((a, x) => (a[x.po_type] = x.c, a), {});
    expect(Object.keys(byType).sort()).toEqual(['installation','service','supply']);
    expect(r.rows.reduce((s, x) => s + x.c, 0)).toBe(12);
  });

  it('writes one status_history row per stage reached (oldest backdated)', async () => {
    const r = await pool.query(`
      SELECT p.po_number, p.current_status, count(h.id)::int hist
        FROM purchase_orders p JOIN purchase_order_status_history h ON h.po_id = p.id
       WHERE p.po_number LIKE 'PO-DEMO-%' GROUP BY p.id LIMIT 1`);
    expect(r.rows[0].hist).toBeGreaterThanOrEqual(1);
  });

  it('every service PO current_status is on the service path', async () => {
    const r = await pool.query(
      `SELECT current_status FROM purchase_orders WHERE po_type='service' AND po_number LIKE 'PO-DEMO-%'`);
    const ok = ['Registered','Processed','Inspected','BAST','Invoice'];
    for (const row of r.rows) expect(ok).toContain(row.current_status);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: FAIL (`seedAll` still a stub → script exits 1 → `execFileSync` throws).

- [ ] **Step 3: Implement customer + PO + history seeding** (replace the `seedAll` stub)

```javascript
const po = require('../src/services/po.service');
// Title-case status → UPPERCASE status_code (status_history CHECK is uppercase).
const CODE = { Registered:'REGISTERED', Processed:'PROCESSED', Production:'PRODUCTION',
  Shipped:'SHIPPED', Customs:'CUSTOMS', Arrived:'ARRIVED', Inspected:'INSPECTED',
  Delivery:'DELIVERY', Installation:'INSTALLATION', BAST:'BAST', Invoice:'INVOICE' };

async function pickActor(client, role) {
  const r = await client.query(
    `SELECT id, role FROM users WHERE role=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [role]);
  return r.rows[0]; // seeded by scripts/seed.js — one per role
}

async function seedCustomers(client, manifest, n) {
  const names = ['PT Maju Bersama','PT Sentosa Abadi','PT Karya Nusantara','CV Mitra Teknik',
    'PT Bumi Persada','PT Cahaya Medika','PT Sinar Laboratorium','PT Andalan Sains',
    'PT Global Instrumen','PT Riset Terpadu','PT Daya Anugerah','CV Solusi Presisi'];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const rec = L.formatRecordNumber('CUST', YEAR, i + 1).replace('CUST-', 'CUST-DEMO-');
    const r = await client.query(
      `INSERT INTO customers (customer_record_number, company_name, city, country, pic_name, customer_status)
       VALUES ($1,$2,'Jakarta','Indonesia',$3,'Active') RETURNING id`,
      [rec, names[i % names.length], `PIC ${i + 1}`]);
    ids.push(r.rows[0].id);
  }
  manifest.customerIds = ids;
  return ids;
}

async function seedAll(manifest) {
  const types = L.planTypeDistribution(TOTAL);
  await db.withTransaction(async (client) => {
    const customers = await seedCustomers(client, manifest, Math.min(12, TOTAL));
    const sales = await pickActor(client, 'sales');
    for (let i = 0; i < types.length; i++) {
      const poType = types[i];
      const path = po.pathFor(poType);
      // spread target stages across the whole path so every stage is represented
      const target = path[i % path.length];
      const poNumber = L.formatRecordNumber(PO_NAMESPACE, YEAR, i + 1); // PO-DEMO-2026-000NN
      const created = new Date(Date.UTC(2026, 0, 1) + i * 36e5 * 24); // staggered ~1/day
      const timeline = L.buildTimeline(path, target, created);
      const last = timeline[timeline.length - 1];
      const customerId = customers[i % customers.length];
      const dueAt = new Date(last.at.getTime() + 7 * 864e5);

      const ins = await client.query(
        `INSERT INTO purchase_orders
           (po_number, po_type, current_status, created_by_user_id, created_by_role,
            updated_by_user_id, updated_by_role, customer_id, due_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'sales',$4,'sales',$5,$6,$7,$8) RETURNING id`,
        [poNumber, poType, last.status, sales.id, customerId, dueAt, created, last.at]);
      const poId = ins.rows[0].id;
      manifest.poIds.push(poId);

      for (const e of timeline) {
        await client.query(
          `INSERT INTO purchase_order_status_history
             (po_id, po_number, status_code, status_label, updated_by_user_id, updated_by_role, created_at)
           VALUES ($1,$2,$3,$4,$5,'sales',$6)`,
          [poId, poNumber, CODE[e.status], e.status, sales.id, e.at]);
        await client.query(
          `INSERT INTO purchase_order_tracking_events (po_id, event_type, payload_json, created_at)
           VALUES ($1,'po.status_advanced',$2::jsonb,$3)`,
          [poId, JSON.stringify({ to: e.status, actor_role: 'sales', seeded: true }), e.at]);
      }
      // documents, invoices, attachments, notifications → Tasks 6–7
      await seedDocuments(client, { poId, poNumber, poType, path, target, customerId, timeline });
    }
  });
}

async function seedDocuments(_client, _ctx) { /* Task 6 */ }
```

> The inline `CODE` map is authoritative for `status_code` (don't rely on `STATUS_CODE` being exported from `po.service.js`).

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: the 3 tests PASS (`seedDocuments` is a no-op for now; counts/paths/history verified).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed-dummy.js backend/test/scripts/seed-dummy.integration.test.js
git commit -m "feat(sub-4): seed customers + typed POs with backdated history/tracking"
```

---

## Task 6: Seed linked documents + multi-termin invoices

**Files:**
- Modify: `backend/scripts/seed-dummy.js` (implement `seedDocuments`)
- Modify: `backend/test/scripts/seed-dummy.integration.test.js` (add linkage assertions)

Document creation rules (by stage reached on the PO's path):
| Created when target ≥ | Table | Types | Key FK |
|---|---|---|---|
| Processed | `quotations` + `sales_purchase_orders` | all | sales_po.`po_id`→PO, `related_quotation_id`→quotation |
| Production | `purchase_requisitions` | supply, installation | `related_po_id`→PO |
| Shipped | `awb_records` | supply, installation | `related_po_id`→PO (NOT NULL) |
| Delivery | `delivery_orders` | supply, installation | `related_po_id`→PO (NOT NULL) |
| BAST | `bast_records` | service, installation | `related_po_id`→PO |
| Invoice | `invoice_customers` (one row per termin) | all | `related_po_id`→PO |

- [ ] **Step 1: Add failing linkage assertions** (append to the integration test)

```javascript
  it('links documents back to their PO via FKs', async () => {
    // every PO at/after Processed has a sales_purchase_orders row pointing at it
    const r = await pool.query(`
      SELECT count(*)::int c FROM sales_purchase_orders s
        JOIN purchase_orders p ON p.id = s.po_id
       WHERE p.po_number LIKE 'PO-DEMO-%'`);
    expect(r.rows[0].c).toBeGreaterThan(0);
  });

  it('creates multi-termin invoice_customers for installation POs at Invoice', async () => {
    const r = await pool.query(`
      SELECT p.id, count(ic.id)::int termins
        FROM purchase_orders p JOIN invoice_customers ic ON ic.related_po_id = p.id
       WHERE p.po_type='installation' AND p.current_status='Invoice' AND p.po_number LIKE 'PO-DEMO-%'
       GROUP BY p.id`);
    if (r.rows.length) expect(r.rows[0].termins).toBeGreaterThanOrEqual(2);
  });
```

- [ ] **Step 2: Run, verify the new assertions fail**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: the two new tests FAIL (no documents yet); earlier tests still PASS.

- [ ] **Step 3: Implement `seedDocuments`** (uses the schema appendix; `reached(stage)` = target index ≥ stage index on this PO's path)

```javascript
async function seedDocuments(client, ctx) {
  const { poId, poNumber, poType, path, target, customerId, timeline } = ctx;
  const idx = (s) => path.indexOf(s);
  const reached = (s) => idx(s) !== -1 && idx(s) <= idx(target);
  const seq = manifestSeq(); // simple incrementing counter across the run
  const atOf = (stage) => (timeline.find(e => e.status === stage) || timeline[timeline.length-1]).at;
  const total = 50_000_000 + (seq % 10) * 25_000_000; // IDR, varied

  if (reached('Processed')) {
    const q = await client.query(
      `INSERT INTO quotations (quotation_record_number, customer_id, quotation_date, total_amount, workflow_status, created_at)
       VALUES ($1,$2,$3,$4,'accepted',$5) RETURNING id`,
      [L.formatRecordNumber('QT-DEMO', YEAR, seq), customerId, atOf('Registered'), total, atOf('Processed')]);
    await client.query(
      `INSERT INTO sales_purchase_orders (po_record_number, po_number, customer_id, related_quotation_id, po_id, total_amount, workflow_status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'processed',$7)`,
      [L.formatRecordNumber('PO-SO-DEMO', YEAR, seq), poNumber, customerId, q.rows[0].id, poId, total, atOf('Processed')]);
  }
  if (reached('Production') && poType !== 'service') {
    await client.query(
      `INSERT INTO purchase_requisitions (pr_record_number, related_po_id, customer_id, supplier_or_manufacturer, pr_date, current_pr_status, created_at)
       VALUES ($1,$2,$3,'PT Supplier Global',$4,'Processed',$5)`,
      [L.formatRecordNumber('PR-DEMO', YEAR, seq), poId, customerId, atOf('Production'), atOf('Production')]);
  }
  if (reached('Shipped') && poType !== 'service') {
    await client.query(
      `INSERT INTO awb_records (awb_record_number, related_po_id, related_po_number, customer_id, forwarder_or_courier, awb_tracking_number, shipment_method, current_awb_status, despatch_date, created_at)
       VALUES ($1,$2,$3,$4,'DHL Express',$5,'Air',$6,$7,$8)`,
      [L.formatRecordNumber('AWB-DEMO', YEAR, seq), poId, poNumber, customerId,
       `1Z${seq}${YEAR}`, reached('Arrived') ? 'Arrived' : 'Processed', atOf('Shipped'), atOf('Shipped')]);
  }
  if (reached('Delivery') && poType !== 'service') {
    await client.query(
      `INSERT INTO delivery_orders (do_record_number, related_po_id, related_po_number, customer_id, delivery_date, shipping_method, current_do_status, created_at)
       VALUES ($1,$2,$3,$4,$5,'Land','Arrived',$6)`,
      [L.formatRecordNumber('DO-DEMO', YEAR, seq), poId, poNumber, customerId, atOf('Delivery'), atOf('Delivery')]);
  }
  if (reached('BAST') && poType !== 'supply') {
    const tech = await pickActor(client, 'technical');
    await client.query(
      `INSERT INTO bast_records (bast_record_number, related_po_id, customer_id, job_type, completion_end_date, scope_summary, technical_pic_id, workflow_status, sent_to_finance, created_at)
       VALUES ($1,$2,$3,'Installation',$4,'Commissioning + training complete',$5,'sent_to_finance',true,$6)`,
      [L.formatRecordNumber('BAST-DEMO', YEAR, seq), poId, customerId, atOf('BAST'), tech.id, atOf('BAST')]);
  }
  if (reached('Invoice')) {
    const plan = L.terminPlanFor(poType, total);
    for (const t of plan) {
      // DP paid early (Processed), Pelunasan/Full at Invoice; mix in some overdue-pending
      const isFinal = t.sequence === plan.length;
      const paid = !isFinal || (seq % 3 !== 0);    // ~1/3 of finals left pending
      const dueDate = isFinal ? atOf('Invoice') : atOf('Processed');
      await client.query(
        `INSERT INTO invoice_customers
           (invoice_customer_record_number, related_po_id, customer_id, invoice_number, invoice_date,
            total_amount, amount, termin_sequence, termin_label, due_date, payment_status, paid_at, invoice_status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Processed',$13)`,
        [L.formatRecordNumber(`INV-DEMO-${t.sequence}`, YEAR, seq), poId, customerId,
         `INV/${YEAR}/${seq}/${t.sequence}`, dueDate, t.amount, t.amount, t.sequence, t.label,
         dueDate, paid ? 'paid' : 'pending', paid ? dueDate : null, dueDate]);
    }
  }
}

// Monotonic per-run counter for unique record numbers.
let _seq = 0;
function manifestSeq() { return (_seq += 1); }
```

> All `*-DEMO-*` record-number prefixes keep dummy docs identifiable and unique. `reached()` guards ensure documents only exist for stages actually reached, matching each type's path.

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: all tests (incl. the two new linkage/termin ones) PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed-dummy.js backend/test/scripts/seed-dummy.integration.test.js
git commit -m "feat(sub-4): seed linked documents (QT/SO/PR/AWB/DO/BAST) + multi-termin invoices"
```

---

## Task 7: Seed S3 attachments (incl. multi-upload) + historical notifications

**Files:**
- Modify: `backend/scripts/seed-dummy.js` (add `seedAttachments` + `seedNotifications`, called from `seedDocuments`/`seedAll`)
- Modify: `backend/test/scripts/seed-dummy.integration.test.js`

Attachments: when `SEED_DUMMY_NO_FILES` is set (tests / no MinIO), insert `file_attachments` rows with synthetic storage paths but SKIP the MinIO `putObject`. Otherwise upload a small generated PDF/JPG buffer to `minio.bucketAttachments`. ~60% of POs get ≥1 file; a few get 2–3 on one entity (multi-upload). Notifications: direct INSERT into `notifications` for the roles in `STATUS_DEFAULT_RECIPIENTS[stage]`, backdated, mixed `is_read` — never via `emit` (no email/WS).

- [ ] **Step 1: Add failing assertions**

```javascript
  it('seeds file_attachments incl. ≥1 PO with multiple files on one entity', async () => {
    const r = await pool.query(`
      SELECT related_entity_id, count(*)::int c FROM file_attachments
       WHERE related_module='purchase_orders'
         AND related_entity_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%')
       GROUP BY related_entity_id ORDER BY c DESC LIMIT 1`);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0].c).toBeGreaterThanOrEqual(2); // multi-upload proven
  });

  it('seeds historical dashboard notifications without enqueuing email', async () => {
    const notif = await pool.query(`
      SELECT count(*)::int c FROM notifications
       WHERE related_module='po-tracking'
         AND related_entity_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%')`);
    expect(notif.rows[0].c).toBeGreaterThan(0);
    const email = await pool.query(`SELECT count(*)::int c FROM email_queue`);
    expect(email.rows[0].c).toBe(0); // seeder never enqueues email
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement attachments + notifications**

```javascript
const crypto = require('crypto');
const minio = require('../src/config/minio');
const NO_FILES = !!process.env.SEED_DUMMY_NO_FILES;
const TINY_PDF = Buffer.from('%PDF-1.4\n%%EOF\n');            // valid-enough placeholder
const TINY_JPG = Buffer.from('ffd8ffd9', 'hex');             // minimal JPEG markers

async function seedAttachment(client, manifest, { poId, filename, mime, buf, at }) {
  const fileId = crypto.randomUUID();
  const ext = filename.split('.').pop().toLowerCase();
  const bucket = minio.bucketAttachments;
  const key = `purchase_orders/${poId}/${fileId}_${filename}`;
  if (!NO_FILES) {
    await minio.getClient().putObject(bucket, key, buf, buf.length, { 'Content-Type': mime });
    manifest.s3Keys.push({ bucket, key });
  }
  await client.query(
    `INSERT INTO file_attachments
       (id, original_filename, mime_type, extension, related_module, related_entity_id,
        storage_bucket, storage_path, size_bytes, uploaded_at, created_at)
     VALUES ($1,$2,$3,$4,'purchase_orders',$5,$6,$7,$8,$9,$9)`,
    [fileId, filename, mime, ext, poId, bucket, key, buf.length, at]);
}

async function seedNotifications(client, { poId, poNumber, timeline }) {
  for (const e of timeline) {
    const roles = po.STATUS_DEFAULT_RECIPIENTS?.[e.status]
      || require('../src/services/po.service').STATUS_DEFAULT_RECIPIENTS?.[e.status] || [];
    // resolve roles → users (one per role from seed.js); insert per recipient
    const users = await client.query(
      `SELECT id FROM users WHERE role = ANY($1) AND deleted_at IS NULL`, [roles]);
    for (const u of users.rows) {
      await client.query(
        `INSERT INTO notifications
           (title, message, recipient_user_id, related_module, related_entity_type, related_entity_id, is_read, created_at)
         VALUES ($1,$2,$3,'po-tracking','purchase_orders',$4,$5,$6)`,
        [`PO ${poNumber} → ${e.status}`, `Purchase order ${poNumber} advanced to ${e.status}.`,
         u.id, poId, Math.random() < 0.5, e.at]);
    }
  }
}
```

Then, inside `seedDocuments` (or right after it in `seedAll`'s loop), call:
```javascript
  await seedNotifications(client, ctx);
  // Attachments are keyed to stages reached: a QC photo at Inspected, and a
  // BAST PDF + photo (multi-upload) at BAST. This guarantees ≥1 multi-file PO.
  if (reached('Inspected')) {
    await seedAttachment(client, manifest, { poId, filename: `inspection_${poNumber}.jpg`, mime: 'image/jpeg', buf: TINY_JPG, at: atOf('Inspected') });
  }
  if (reached('BAST') && poType !== 'supply') {
    await seedAttachment(client, manifest, { poId, filename: `bast_${poNumber}.pdf`, mime: 'application/pdf', buf: TINY_PDF, at: atOf('BAST') });
    await seedAttachment(client, manifest, { poId, filename: `bast_photo_${poNumber}.jpg`, mime: 'image/jpeg', buf: TINY_JPG, at: atOf('BAST') }); // multi-upload
  }
```

> `seedDocuments` needs `manifest` in scope — change its signature to `seedDocuments(client, manifest, ctx)` and update the call in `seedAll`. Export `STATUS_DEFAULT_RECIPIENTS` from `po.service.js` (add to module.exports) so the seeder reuses the canonical recipient map (avoids duplicating dept-routing).

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: all PASS (attachments rows present with a multi-file PO; notifications present; `email_queue` empty).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed-dummy.js backend/src/services/po.service.js backend/test/scripts/seed-dummy.integration.test.js
git commit -m "feat(sub-4): seed S3 attachments (multi-upload) + dept-scoped historical notifications"
```

---

## Task 8: `--reset` teardown (DB children + S3 objects)

**Files:**
- Modify: `backend/scripts/seed-dummy.js` (implement `teardown`)
- Modify: `backend/test/scripts/seed-dummy.integration.test.js`

- [ ] **Step 1: Add failing assertion**

```javascript
  it('--reset removes the prior batch (POs + children) leaving none', async () => {
    run(['--reset']);            // reseed
    run(['--reset']);            // reset (delete) then reseed again — net: a fresh batch, no dupes
    const r = await pool.query(`SELECT count(*)::int c FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%'`);
    expect(r.rows[0].c).toBe(12); // exactly one batch, not 24
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: FAIL (teardown is a stub that throws, OR duplicates accumulate).

- [ ] **Step 3: Implement `teardown`**

```javascript
async function teardown(manifest) {
  // Delete S3 objects first (best-effort).
  if (manifest && manifest.s3Keys && manifest.s3Keys.length && !NO_FILES) {
    for (const { bucket, key } of manifest.s3Keys) {
      try { await minio.getClient().removeObject(bucket, key); } catch (e) { /* ignore */ }
    }
  }
  // Delete DB rows. Prefer manifest PO ids; fall back to the PO-DEMO namespace.
  const poIds = (manifest && manifest.poIds) || [];
  await db.withTransaction(async (client) => {
    const where = poIds.length
      ? { sql: 'id = ANY($1)', args: [poIds] }
      : { sql: `po_number LIKE 'PO-DEMO-%'`, args: [] };
    const ids = (await client.query(`SELECT id FROM purchase_orders WHERE ${where.sql}`, where.args)).rows.map(r => r.id);
    if (ids.length) {
      // children that reference PO (status_history/tracking_events cascade on PO delete)
      await client.query(`DELETE FROM file_attachments WHERE related_module='purchase_orders' AND related_entity_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM notifications WHERE related_module='po-tracking' AND related_entity_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM invoice_customers WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM bast_records WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM delivery_orders WHERE related_po_id = ANY($1)`, [ids]);   // RESTRICT → must precede PO delete
      await client.query(`DELETE FROM awb_records WHERE related_po_id = ANY($1)`, [ids]);        // RESTRICT → must precede PO delete
      await client.query(`DELETE FROM purchase_requisitions WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM sales_purchase_orders WHERE po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [ids]); // cascades history + tracking
    }
    // Quotations + demo customers are not PO-FK'd; clean by namespace.
    await client.query(`DELETE FROM quotations WHERE quotation_record_number LIKE 'QT-DEMO-%'`);
    await client.query(`DELETE FROM customers WHERE customer_record_number LIKE 'CUST-DEMO-%'`);
  });
  if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
}
```

> Order matters: `awb_records`/`delivery_orders` are `ON DELETE RESTRICT` on `related_po_id`, so they MUST be deleted before the `purchase_orders` rows. `status_history`/`tracking_events` cascade automatically.

- [ ] **Step 4: Run the integration test (full file)**

Run: `npx vitest run test/scripts/seed-dummy.integration.test.js`
Expected: ALL PASS, including no-duplication after double `--reset`.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed-dummy.js backend/test/scripts/seed-dummy.integration.test.js
git commit -m "feat(sub-4): --reset teardown of dummy batch (DB children + S3 objects)"
```

---

## Task 9: Full run against staging + dashboard verification (manual, gated)

**Files:** none (operational).

This writes ~100 POs + real S3 objects to the **live demo/staging** stack. Run only after the user gives the go-ahead (per spec §3.6). The api container can reach `postgres-global` + minio-global directly, so run it **inside the container** to get the right network + MinIO env.

- [ ] **Step 1: Run the seeder inside the api container against staging**

```bash
docker exec interlab-api node scripts/seed-dummy.js --reset
```
Expected tail: `[seed-dummy] done: 100 POs, NN S3 objects.`

- [ ] **Step 2: Verify data shape (counts by type/stage, termins, attachments)**

```bash
docker exec interlab-api node -e '
const db=require("/app/src/config/database");
(async()=>{
  for (const q of [
    ["by type",`SELECT po_type, count(*)::int FROM purchase_orders WHERE po_number LIKE '"'"'PO-DEMO-%'"'"' GROUP BY po_type`],
    ["by stage",`SELECT current_status, count(*)::int FROM purchase_orders WHERE po_number LIKE '"'"'PO-DEMO-%'"'"' GROUP BY current_status ORDER BY 1`],
    ["termins",`SELECT payment_status, count(*)::int FROM invoice_customers ic JOIN purchase_orders p ON p.id=ic.related_po_id WHERE p.po_number LIKE '"'"'PO-DEMO-%'"'"' GROUP BY payment_status`],
    ["attachments",`SELECT count(*)::int FROM file_attachments WHERE related_module='"'"'purchase_orders'"'"'`],
  ]) { console.log("==",q[0]); console.table((await db.query(q[1])).rows); }
  process.exit(0);
})();'
```
Expected: ~40/30/30 by type; all 11 stages represented; mix of paid/pending termins; attachments > 0.

- [ ] **Step 3: Verify dashboards by login (manual, user)**

Ask the user to log in as each role (Sales / Finance / Technical / Admin&Log / Superadmin) and confirm: dashboard widgets non-empty, PO tracking shows progress, Recent Notifications populated, Finance billing shows paid/pending/overdue, a presigned attachment opens.

- [ ] **Step 4: STOP — await user confirmation that it works.** Do not push or open an MR until the user confirms (per their workflow). Then: push the branch + MR to `main` + merge + delete branch.

---

## Self-review notes (author)
- **Spec coverage:** §1.1 paths → Task 3; §1.2 termins → Tasks 2,6; §2.1 migrations → Tasks 1,2; §2.2 state machine → Task 3; §3.1–3.5 seeder → Tasks 4–7; §3.6 idempotency/reset → Tasks 4,8; §4 acceptance → exercised across Tasks 5–9; §0 "no Redis cache" honored (none added). ✓
- **Status case:** `current_status` Title-case vs `status_code` UPPERCASE handled via `CODE`/`STATUS_CODE`. ✓
- **RESTRICT FKs:** `awb_records`/`delivery_orders` deleted before POs in teardown. ✓
- **No live side-effects:** seeder INSERTs notifications directly (no `emit`), asserts `email_queue` stays empty. ✓
- **Naming:** `pathFor`/`assertOnPath`/`seedDocuments`/`seedAttachments`/`seedNotifications`/`teardown` used consistently across tasks.

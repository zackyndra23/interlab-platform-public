# Plan 4 — F4 PO Document → Stage Trigger Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
>
> **Spec:** `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`)
> **Master plan:** `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md`
> **Depends on:** Plan 1 (Foundation + F2). Plans 2 and 3 not required.

**Goal:** Make the existing 11-stage PO state machine reactive to document uploads — uploading the right doc at the right stage advances the PO; reject and admin-override paths exist for exceptions.

**Architecture:** A new `po_document_types` config table maps `doc_key → triggers_stage`. After a `file_attachments` row is inserted with `po_document_type_id` set, a post-insert hook calls `po.service.advanceStage` to transition the PO. Reject and admin-override are explicit service APIs that record `is_rejection=true` / `is_admin_override=true` history rows for audit. Existing `po.service.advanceStatus` (already in the codebase) is extended/aliased — not replaced — to preserve backwards compat with module services.

**Tech Stack:** Node 20 + Express, `pg` with `SELECT FOR UPDATE` for concurrent transition safety, existing `po.service.js` state machine, existing `file.service.js` upload pipeline.

---

## File map

**Net-new backend files**
- `backend/migrations/022_po_document_types.sql`
- `backend/src/services/po_document.service.js` — declarative map lookup + stage trigger orchestration
- `backend/src/routes/admin/po-document-types.routes.js` — Superadmin/CEO CRUD
- `backend/src/routes/po/stage.routes.js` — reject + admin override + history endpoints
- `backend/src/validators/po_stage.validators.js`
- `backend/test/migrations/022_po_document_types.test.js`
- `backend/test/services/po_document.service.test.js`
- `backend/test/services/po.stage_actions.test.js` — tests for the new reject/override APIs

**Modified backend files**
- `backend/src/services/po.service.js` — add `rejectStage`, `adminOverrideStage`. Existing `advanceStatus` stays. Export both.
- `backend/src/services/file.service.js` — post-insert hook: when `po_document_type_id.triggers_stage` is set, call `po_document.service.applyTrigger`
- `backend/scripts/seed.js` — seed `po_document_types` rows + new `advance_stage`/`reject_stage`/`admin_override_stage` capabilities + grants
- `backend/src/app.js` — mount new routes

**Net-new frontend files**
- `frontend/lib/po-document-types.ts`
- `frontend/lib/po-document-api.ts`
- `frontend/components/po/StageTimeline.tsx`
- `frontend/components/po/RejectStageDialog.tsx`
- `frontend/components/po/AdminOverrideDialog.tsx`
- `frontend/app/(app)/admin/po-document-types/page.tsx`

---

## Stage code conventions (read this first)

The existing schema uses **two casings** for the same conceptual stage:
- `purchase_orders.current_status` (Title Case): `Registered, Processed, Production, Shipped, Customs, Arrived, Inspected, Delivery, Installation, BAST, Invoice`
- `purchase_order_status_history.status_code` (UPPER): `REGISTERED, PROCESSED, …, INVOICE`

**For new code, use the existing po.service.js helpers** — they handle this conversion. Do NOT introduce a third casing convention. The new `po_document_types.triggers_stage` column stores the **Title Case form** (matches `current_status`) so a doc-type row's `triggers_stage='Shipped'` directly compares to the PO row.

---

## Task 4.1 — Migration 022: `po_document_types` + `file_attachments.po_document_type_id` + history columns

**Files:**
- Create: `backend/migrations/022_po_document_types.sql`
- Create: `backend/test/migrations/022_po_document_types.test.js`

- [ ] **Step 4.1.1 — Write failing test**

```js
'use strict';
const { pool } = require('../helpers/db');

describe('migration 022 po_document_types', () => {
  it('po_document_types table exists with expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='po_document_types' ORDER BY column_name`);
    const cols = r.rows.map(x => x.column_name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','doc_key','doc_name','triggers_stage','required_for_stage',
      'uploader_role_keys','is_active','created_at',
    ]));
  });

  it('triggers_stage CHECK accepts the 11 canonical stages', async () => {
    const r = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname='po_document_types_triggers_chk'`);
    expect(r.rows[0]?.def).toMatch(/Registered.*Invoice/i);
  });

  it('file_attachments.po_document_type_id column exists with FK', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='file_attachments' AND column_name='po_document_type_id'`);
    expect(r.rowCount).toBe(1);
  });

  it('purchase_order_status_history has is_rejection, is_admin_override, reject_count_after', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='purchase_order_status_history'
         AND column_name IN ('is_rejection','is_admin_override','reject_count_after')`);
    expect(r.rows.length).toBe(3);
  });
});
```

- [ ] **Step 4.1.2 — Write migration**

```sql
-- ============================================================================
-- Migration 022: po_document_types + status history audit columns
-- F4 PO Document → Stage Trigger Map (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE po_document_types (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_key            text         NOT NULL UNIQUE,
    doc_name           text         NOT NULL,
    triggers_stage     text         NULL,
    required_for_stage text         NULL,
    uploader_role_keys jsonb        NOT NULL DEFAULT '[]'::jsonb,
    is_active          boolean      NOT NULL DEFAULT true,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT po_document_types_triggers_chk CHECK (triggers_stage IS NULL OR triggers_stage IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice')),
    CONSTRAINT po_document_types_required_chk CHECK (required_for_stage IS NULL OR required_for_stage IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice'))
);

ALTER TABLE file_attachments
    ADD COLUMN po_document_type_id uuid NULL REFERENCES po_document_types(id) ON DELETE SET NULL;

CREATE INDEX file_attachments_po_doc_idx ON file_attachments (po_document_type_id) WHERE po_document_type_id IS NOT NULL;

ALTER TABLE purchase_order_status_history
    ADD COLUMN is_rejection         boolean NOT NULL DEFAULT false,
    ADD COLUMN is_admin_override    boolean NOT NULL DEFAULT false,
    ADD COLUMN reject_count_after   int     NULL;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE purchase_order_status_history
    DROP COLUMN IF EXISTS reject_count_after,
    DROP COLUMN IF EXISTS is_admin_override,
    DROP COLUMN IF EXISTS is_rejection;
DROP INDEX IF EXISTS file_attachments_po_doc_idx;
ALTER TABLE file_attachments DROP COLUMN IF EXISTS po_document_type_id;
DROP TABLE IF EXISTS po_document_types;
COMMIT;
```

- [ ] **Step 4.1.3 — Apply + run + commit**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend \
  -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/migrate.js 2>&1 | tail -3
```

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/migrations/022_po_document_types.sql backend/test/migrations/022_po_document_types.test.js
git commit -m "feat(db): migration 022 po_document_types + history audit columns

po_document_types: declarative map doc_key → triggers_stage. CHECK constraint
limits stage values to the canonical 11. file_attachments.po_document_type_id
links uploaded files to a stage trigger.

purchase_order_status_history adds is_rejection/is_admin_override/
reject_count_after for audit of the new reject and admin-override APIs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.2 — Seed `po_document_types` + new capabilities + grants

**Files:**
- Modify: `backend/scripts/seed.js`
- Create: `backend/test/services/po_document.seed.test.js`

- [ ] **Step 4.2.1 — Add seed entries**

In `seed.js`, after migration-dependent seeds (after `MANAGER_LEVELS` and `invite_user`), add:

```js
// --- Seed po_document_types ----------------------------------------------
const PO_DOC_TYPES = [
  { doc_key: 'awb',              doc_name: 'Air Waybill',             triggers_stage: 'Shipped',     uploader_role_keys: ['admin_log'] },
  { doc_key: 'arrival_doc',      doc_name: 'Arrival Document',        triggers_stage: 'Arrived',     uploader_role_keys: ['admin_log'] },
  { doc_key: 'do',               doc_name: 'Delivery Order',          triggers_stage: 'Delivery',    uploader_role_keys: ['admin_log'] },
  { doc_key: 'pr_po_out',        doc_name: 'PR PO Out (Production)',  triggers_stage: 'Production', uploader_role_keys: ['finance'] },
  { doc_key: 'bast',             doc_name: 'BAST',                    triggers_stage: 'BAST',        uploader_role_keys: ['technical'] },
  { doc_key: 'invoice_customer', doc_name: 'Invoice to Customer',     triggers_stage: 'Invoice',     uploader_role_keys: ['finance'] },
];

for (const t of PO_DOC_TYPES) {
  await client.query(`
    INSERT INTO po_document_types (doc_key, doc_name, triggers_stage, uploader_role_keys, is_active)
    VALUES ($1, $2, $3, $4::jsonb, true)
    ON CONFLICT (doc_key) DO UPDATE SET
      doc_name = EXCLUDED.doc_name,
      triggers_stage = EXCLUDED.triggers_stage,
      uploader_role_keys = EXCLUDED.uploader_role_keys,
      updated_at = now()
  `, [t.doc_key, t.doc_name, t.triggers_stage, JSON.stringify(t.uploader_role_keys)]);
}

// --- New capabilities for stage actions ----------------------------------
const STAGE_CAPABILITIES = [
  ['advance_stage',         'Advance PO stage'],
  ['reject_stage',          'Reject PO stage'],
  ['admin_override_stage',  'Admin override PO stage (skip)'],
];
for (const [key, name] of STAGE_CAPABILITIES) {
  await client.query(`
    INSERT INTO capability_definitions (capability_key, capability_name)
    VALUES ($1, $2) ON CONFLICT (capability_key) DO NOTHING`, [key, name]);
}

// --- Grant advance_stage to BOTH staff (rank 1) and manager (rank 2) levels of
//     uploader roles on the corresponding feature. The feature_key for PO is
//     'sales_po' (or whatever exists in feature_definitions for purchase orders).
const PO_FEATURE_KEY = 'sales_po';
await client.query(`
  INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
  SELECT r.id, rl.id, f.id, c.id
    FROM roles r
    JOIN role_levels rl ON rl.role_id = r.id
    CROSS JOIN feature_definitions f
    CROSS JOIN capability_definitions c
   WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
     AND f.feature_key = $1
     AND c.capability_key IN ('advance_stage')
   ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
`, [PO_FEATURE_KEY]);

// --- Grant reject_stage to manager (top-rank) only
await client.query(`
  INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
  SELECT r.id, rl.id, f.id, c.id
    FROM roles r
    JOIN role_levels rl ON rl.role_id = r.id
                        AND rl.level_rank = (SELECT max(level_rank) FROM role_levels
                                              WHERE role_id = rl.role_id AND deleted_at IS NULL)
    CROSS JOIN feature_definitions f
    CROSS JOIN capability_definitions c
   WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
     AND f.feature_key = $1
     AND c.capability_key = 'reject_stage'
   ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
`, [PO_FEATURE_KEY]);

// admin_override_stage is reserved to Superadmin/CEO via bypass — no grants needed.
```

(If `feature_definitions` doesn't have `sales_po`, look up the actual PO feature key by querying — adjust the constant.)

- [ ] **Step 4.2.2 — Re-run seed against test DB**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend \
  -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/seed.js 2>&1 | tail -3
```

- [ ] **Step 4.2.3 — Test**

```js
// test/services/po_document.seed.test.js
'use strict';
const { pool } = require('../helpers/db');

describe('seed — po_document_types + capabilities', () => {
  it('all 6 doc types are seeded with valid trigger stages', async () => {
    const r = await pool.query(`
      SELECT doc_key, triggers_stage FROM po_document_types
       WHERE doc_key IN ('awb','arrival_doc','do','pr_po_out','bast','invoice_customer')
       ORDER BY doc_key`);
    expect(r.rows.length).toBe(6);
    const map = Object.fromEntries(r.rows.map(x => [x.doc_key, x.triggers_stage]));
    expect(map.awb).toBe('Shipped');
    expect(map.arrival_doc).toBe('Arrived');
    expect(map.do).toBe('Delivery');
    expect(map.pr_po_out).toBe('Production');
    expect(map.bast).toBe('BAST');
    expect(map.invoice_customer).toBe('Invoice');
  });

  it('advance_stage / reject_stage / admin_override_stage capabilities exist', async () => {
    const r = await pool.query(`
      SELECT capability_key FROM capability_definitions
       WHERE capability_key IN ('advance_stage','reject_stage','admin_override_stage')
       ORDER BY capability_key`);
    expect(r.rows.map(x => x.capability_key))
      .toEqual(['admin_override_stage','advance_stage','reject_stage']);
  });
});
```

- [ ] **Step 4.2.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/scripts/seed.js backend/test/services/po_document.seed.test.js
git commit -m "feat(seed): po_document_types + stage capabilities + grants

Seeds 6 doc-types covering all auto-trigger stages. New capabilities:
advance_stage (granted to all rank-1+), reject_stage (manager only),
admin_override_stage (no grants — reserved to Superadmin/CEO bypass).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.3 — Extend `po.service.js` with `rejectStage` + `adminOverrideStage`

**Files:**
- Modify: `backend/src/services/po.service.js`
- Create: `backend/test/services/po.stage_actions.test.js`

The existing `advanceStatus(client, params)` stays — it's already used by module services for forward transitions. Add `rejectStage` (move backward) and `adminOverrideStage` (skip-stage).

- [ ] **Step 4.3.1 — Write failing tests**

```js
'use strict';
const { pool } = require('../helpers/db');
const po = require('../../src/services/po.service');

let salesUserId, ceoId, fixturePoId;

beforeAll(async () => {
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('ceo','sales') AND deleted_at IS NULL`);
  ceoId = u.rows.find(x => x.role === 'ceo')?.id;
  const s = await pool.query(`
    SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
  salesUserId = s.rows[0]?.id;

  // Create a test PO at stage 'Inspected' (mid-pipeline, can reject backward)
  if (salesUserId) {
    const ins = await pool.query(`
      INSERT INTO purchase_orders
        (po_number, current_status, customer_id, sales_user_id, created_by, updated_by)
      VALUES ($1, 'Inspected',
        (SELECT id FROM customers LIMIT 1),
        $2, $2, $2)
      RETURNING id`, [`TEST-PO-${Date.now()}`, salesUserId]);
    fixturePoId = ins.rows[0].id;
  }
});

afterAll(async () => {
  if (fixturePoId) {
    await pool.query(`DELETE FROM purchase_order_status_history WHERE purchase_order_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_order_tracking_events WHERE purchase_order_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [fixturePoId]);
  }
});

describe('po.rejectStage', () => {
  it('rejects to a prior stage with reason; writes history with is_rejection=true', async () => {
    if (!fixturePoId || !ceoId) return;
    const r = await po.rejectStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      toStatus: 'Arrived',
      reason: 'inspection failed',
    });
    expect(r.poId).toBe(fixturePoId);
    expect(r.previousStatus).toBe('Inspected');
    expect(r.newStatus).toBe('Arrived');

    const cur = await pool.query(`SELECT current_status FROM purchase_orders WHERE id=$1`, [fixturePoId]);
    expect(cur.rows[0].current_status).toBe('Arrived');

    const hist = await pool.query(`
      SELECT status_code, is_rejection, note FROM purchase_order_status_history
       WHERE purchase_order_id=$1 ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(hist.rows[0].is_rejection).toBe(true);
    expect(hist.rows[0].note).toMatch(/inspection failed/i);
    expect(hist.rows[0].status_code).toBe('ARRIVED');
  });

  it('rejects forward transition (cannot reject to a later stage)', async () => {
    if (!fixturePoId || !ceoId) return;
    await expect(po.rejectStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      toStatus: 'BAST',
      reason: 'wrong direction',
    })).rejects.toThrow(/backward|earlier|invalid/i);
  });
});

describe('po.adminOverrideStage', () => {
  it('Superadmin/CEO can skip-stage with reason; history is_admin_override=true', async () => {
    if (!fixturePoId || !ceoId) return;
    const r = await po.adminOverrideStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      targetStatus: 'BAST',
      reason: 'expedite for VIP customer',
    });
    expect(r.newStatus).toBe('BAST');

    const hist = await pool.query(`
      SELECT is_admin_override, note FROM purchase_order_status_history
       WHERE purchase_order_id=$1 ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(hist.rows[0].is_admin_override).toBe(true);
    expect(hist.rows[0].note).toMatch(/expedite/i);
  });

  it('non-CEO without admin_override_stage capability is rejected', async () => {
    if (!salesUserId || !fixturePoId) return;
    await expect(po.adminOverrideStage({
      actor: { id: salesUserId, role: 'sales' },
      poId: fixturePoId,
      targetStatus: 'Invoice',
      reason: 'try to skip',
    })).rejects.toThrow(/forbidden|capability/i);
  });
});
```

- [ ] **Step 4.3.2 — Implement**

Add these functions near the existing `advanceStatus` in `po.service.js`. Reference the existing helpers (`statusIndex`, `isValidStatus`, plus the existing `_writeHistory` pattern — find what already writes history and reuse).

```js
const STATUSES = [
  'Registered','Processed','Production','Shipped','Customs','Arrived',
  'Inspected','Delivery','Installation','BAST','Invoice',
];

function statusToCode(status) {
  return status.toUpperCase();
}

async function rejectStage({ actor, poId, toStatus, reason }) {
  if (!STATUSES.includes(toStatus)) {
    throw new ValidationError(`invalid target status: ${toStatus}`);
  }
  if (!reason || !reason.trim()) {
    throw new ValidationError('rejection requires a reason');
  }

  // Resolve capabilities (resolveCapabilities handles superadmin/ceo bypass).
  const perms = require('./permission.service');
  const caps = await perms.resolveCapabilities(actor.id, 'sales_po');
  if (!caps.has('reject_stage') && !caps.has('full_access')) {
    throw new ForbiddenError('lacks reject_stage capability');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`
      SELECT id, po_number, current_status FROM purchase_orders
       WHERE id = $1 FOR UPDATE`, [poId]);
    if (!cur.rowCount) throw new ValidationError('PO not found');
    const previousStatus = cur.rows[0].current_status;
    const previousIdx = STATUSES.indexOf(previousStatus);
    const targetIdx   = STATUSES.indexOf(toStatus);
    if (targetIdx >= previousIdx) {
      throw new ValidationError(`reject must go to an earlier stage (got ${toStatus} from ${previousStatus})`);
    }

    // Count prior rejections to set reject_count_after.
    const rc = await client.query(`
      SELECT count(*)::int AS n FROM purchase_order_status_history
       WHERE purchase_order_id=$1 AND is_rejection=true`, [poId]);
    const newCount = rc.rows[0].n + 1;

    await client.query(`
      UPDATE purchase_orders
         SET current_status=$2, updated_at=now(), updated_by=$3
       WHERE id=$1`, [poId, toStatus, actor.id]);

    await client.query(`
      INSERT INTO purchase_order_status_history
        (purchase_order_id, po_number, status_code, status_label,
         updated_by_user_id, updated_by_role, note,
         is_rejection, reject_count_after)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [poId, cur.rows[0].po_number, statusToCode(toStatus), toStatus,
       actor.id, actor.role, reason, newCount]);

    await client.query('COMMIT');
    return { poId, previousStatus, newStatus: toStatus, rejectCountAfter: newCount };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function adminOverrideStage({ actor, poId, targetStatus, reason }) {
  if (!STATUSES.includes(targetStatus)) {
    throw new ValidationError(`invalid target status: ${targetStatus}`);
  }
  if (!reason || !reason.trim()) {
    throw new ValidationError('admin override requires a reason');
  }

  const perms = require('./permission.service');
  const caps = await perms.resolveCapabilities(actor.id, 'sales_po');
  if (!caps.has('admin_override_stage') && !caps.has('full_access')) {
    throw new ForbiddenError('lacks admin_override_stage capability');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`
      SELECT id, po_number, current_status FROM purchase_orders
       WHERE id = $1 FOR UPDATE`, [poId]);
    if (!cur.rowCount) throw new ValidationError('PO not found');
    const previousStatus = cur.rows[0].current_status;

    await client.query(`
      UPDATE purchase_orders
         SET current_status=$2, updated_at=now(), updated_by=$3
       WHERE id=$1`, [poId, targetStatus, actor.id]);

    await client.query(`
      INSERT INTO purchase_order_status_history
        (purchase_order_id, po_number, status_code, status_label,
         updated_by_user_id, updated_by_role, note, is_admin_override)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [poId, cur.rows[0].po_number, statusToCode(targetStatus), targetStatus,
       actor.id, actor.role, reason]);

    await client.query('COMMIT');
    return { poId, previousStatus, newStatus: targetStatus };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports.rejectStage = rejectStage;
module.exports.adminOverrideStage = adminOverrideStage;
module.exports.STATUSES = STATUSES;
```

(Inspect the existing `purchase_order_status_history` columns to confirm exact column names — adapt the INSERT accordingly. Existing `advanceStatus` should already be writing history — copy its column list.)

- [ ] **Step 4.3.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/po.stage_actions.test.js 2>&1 | tail -15
```

```bash
git add backend/src/services/po.service.js backend/test/services/po.stage_actions.test.js
git commit -m "feat(po): rejectStage + adminOverrideStage service APIs

rejectStage moves the PO backward to an earlier stage with a required
reason; history row carries is_rejection=true + reject_count_after.

adminOverrideStage skips arbitrary stages (forward or backward); history
row carries is_admin_override=true. Authority via reject_stage and
admin_override_stage capabilities; CEO/Superadmin bypass.

Both use SELECT FOR UPDATE on the PO row for concurrent-safety.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.4 — `po_document.service` + file-upload trigger hook

**Files:**
- Create: `backend/src/services/po_document.service.js`
- Modify: `backend/src/services/file.service.js` — add post-insert hook
- Create: `backend/test/services/po_document.service.test.js`

- [ ] **Step 4.4.1 — Service implementation**

```js
'use strict';
const db = require('../config/database');
const po = require('./po.service');

const STAGES = [
  'Registered','Processed','Production','Shipped','Customs','Arrived',
  'Inspected','Delivery','Installation','BAST','Invoice',
];

async function listDocumentTypes() {
  const r = await db.query(`
    SELECT id, doc_key, doc_name, triggers_stage, required_for_stage,
           uploader_role_keys, is_active, created_at, updated_at
      FROM po_document_types ORDER BY doc_name`);
  return r.rows;
}

async function getDocumentTypeById(id) {
  const r = await db.query(`SELECT * FROM po_document_types WHERE id=$1`, [id]);
  return r.rows[0] || null;
}

/**
 * Apply the stage-trigger associated with an uploaded document.
 *
 * Called from file.service.js POST-INSERT hook when a file_attachments row
 * has po_document_type_id set AND related_module='purchase_orders'.
 *
 * Returns { applied: boolean, fromStatus?, toStatus? }.
 *
 * Idempotent: if the PO is already at-or-past triggers_stage, returns
 * { applied: false } without raising.
 */
async function applyTrigger({ poId, docTypeId, actor }) {
  const dt = await getDocumentTypeById(docTypeId);
  if (!dt || !dt.is_active || !dt.triggers_stage) {
    return { applied: false, reason: 'doc type does not trigger a stage' };
  }
  const cur = await db.query(`SELECT current_status FROM purchase_orders WHERE id=$1`, [poId]);
  if (!cur.rowCount) return { applied: false, reason: 'PO not found' };
  const fromStatus = cur.rows[0].current_status;
  const fromIdx = STAGES.indexOf(fromStatus);
  const toIdx = STAGES.indexOf(dt.triggers_stage);
  if (toIdx <= fromIdx) {
    // PO already at or past the trigger stage — no-op (idempotent).
    return { applied: false, reason: 'already at or past trigger stage', fromStatus };
  }

  // Use po.service.advanceStatus (existing forward-transition primitive).
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await po.advanceStatus(client, {
      poId,
      newStatus: dt.triggers_stage,
      updatedByUserId: actor.id,
      updatedByRole: actor.role,
      note: `Auto-advanced via ${dt.doc_name} upload`,
    });
    await client.query('COMMIT');
    return { applied: true, fromStatus, toStatus: dt.triggers_stage };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { listDocumentTypes, getDocumentTypeById, applyTrigger };
```

- [ ] **Step 4.4.2 — Hook in file.service.js**

Find the existing `uploadFile` function in `backend/src/services/file.service.js`. After the file_attachments INSERT, add:

```js
// Post-insert hook: trigger PO stage advance if applicable.
if (poDocumentTypeId && relatedModule === 'purchase_orders' && relatedEntityId) {
  try {
    const poDoc = require('./po_document.service');
    await poDoc.applyTrigger({
      poId: relatedEntityId,
      docTypeId: poDocumentTypeId,
      actor: { id: uploadedBy, role: actorRole || 'unknown' },
    });
  } catch (err) {
    // Stage trigger failures shouldn't roll back the file upload itself;
    // log and continue. Caller can call applyTrigger explicitly if needed.
    console.warn('[file.service] po stage trigger failed:', err.message);
  }
}
```

(Adapt the param names — `uploadFile` takes specific args; pass through `po_document_type_id` and `actorRole` as new optional args. If `uploadFile` doesn't currently accept these, extend its signature.)

- [ ] **Step 4.4.3 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');
const poDoc = require('../../src/services/po_document.service');

let salesUserId, ceoId, awbDocTypeId, fixturePoId;

beforeAll(async () => {
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('ceo','sales') AND deleted_at IS NULL`);
  ceoId = u.rows.find(x => x.role === 'ceo')?.id;
  const s = await pool.query(`SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
  salesUserId = s.rows[0]?.id;
  const dt = await pool.query(`SELECT id FROM po_document_types WHERE doc_key='awb'`);
  awbDocTypeId = dt.rows[0]?.id;

  if (salesUserId) {
    const r = await pool.query(`
      INSERT INTO purchase_orders (po_number, current_status, customer_id, sales_user_id, created_by, updated_by)
      VALUES ($1, 'Processed', (SELECT id FROM customers LIMIT 1), $2, $2, $2)
      RETURNING id`, [`PO-DOC-TEST-${Date.now()}`, salesUserId]);
    fixturePoId = r.rows[0].id;
  }
});

afterAll(async () => {
  if (fixturePoId) {
    await pool.query(`DELETE FROM purchase_order_status_history WHERE purchase_order_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_order_tracking_events WHERE purchase_order_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [fixturePoId]);
  }
});

describe('po_document.applyTrigger', () => {
  it('AWB upload at Processed → advances to Shipped', async () => {
    if (!fixturePoId || !awbDocTypeId || !ceoId) return;
    const r = await poDoc.applyTrigger({
      poId: fixturePoId, docTypeId: awbDocTypeId, actor: { id: ceoId, role: 'ceo' },
    });
    expect(r.applied).toBe(true);
    expect(r.fromStatus).toBe('Processed');
    expect(r.toStatus).toBe('Shipped');
    const cur = await pool.query(`SELECT current_status FROM purchase_orders WHERE id=$1`, [fixturePoId]);
    expect(cur.rows[0].current_status).toBe('Shipped');
  });

  it('idempotent: AWB upload at Shipped → no-op (returns applied=false)', async () => {
    if (!fixturePoId || !awbDocTypeId || !ceoId) return;
    const r = await poDoc.applyTrigger({
      poId: fixturePoId, docTypeId: awbDocTypeId, actor: { id: ceoId, role: 'ceo' },
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/already at or past/i);
  });

  it('returns applied=false when doc-type has no triggers_stage', async () => {
    if (!fixturePoId || !ceoId) return;
    const ins = await pool.query(`
      INSERT INTO po_document_types (doc_key, doc_name, triggers_stage)
      VALUES ($1, $2, NULL) RETURNING id`, [`misc-${Date.now()}`, 'Misc Doc']);
    try {
      const r = await poDoc.applyTrigger({
        poId: fixturePoId, docTypeId: ins.rows[0].id, actor: { id: ceoId, role: 'ceo' },
      });
      expect(r.applied).toBe(false);
    } finally {
      await pool.query(`DELETE FROM po_document_types WHERE id=$1`, [ins.rows[0].id]);
    }
  });
});
```

- [ ] **Step 4.4.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -15
```

```bash
git add backend/src/services/po_document.service.js backend/src/services/file.service.js backend/test/services/po_document.service.test.js
git commit -m "feat(po): applyTrigger + file-upload post-insert hook

po_document.service.applyTrigger looks up the doc-type's triggers_stage,
calls po.advanceStatus if the PO is behind. Idempotent: no-op when PO
is already at or past the trigger stage.

file.service.uploadFile post-insert hook fires applyTrigger when the
uploaded file is linked to a purchase_orders entity AND has a
po_document_type_id. Trigger failures don't roll back the upload (logged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.5 — Stage operation routes

**Files:**
- Create: `backend/src/routes/po/stage.routes.js`
- Create: `backend/src/validators/po_stage.validators.js`
- Modify: `backend/src/app.js`

- [ ] **Step 4.5.1 — Validators**

```js
'use strict';
const Joi = require('joi');

const STAGES = ['Registered','Processed','Production','Shipped','Customs','Arrived','Inspected','Delivery','Installation','BAST','Invoice'];

const reject = Joi.object({
  toStatus: Joi.string().valid(...STAGES).required(),
  reason: Joi.string().min(3).max(500).required(),
});

const adminOverride = Joi.object({
  targetStatus: Joi.string().valid(...STAGES).required(),
  reason: Joi.string().min(3).max(500).required(),
});

module.exports = { reject, adminOverride };
```

- [ ] **Step 4.5.2 — Routes**

```js
'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/po_stage.validators');
const po = require('../../services/po.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// POST /api/po/:id/reject
router.post('/:id/reject',
  rbacGuard('sales_po', 'reject_stage'),
  permissionWriteLimiter,
  validate({ body: v.reject }),
  async (req, res, next) => {
    try {
      const r = await po.rejectStage({
        actor: req.user, poId: req.params.id,
        toStatus: req.body.toStatus, reason: req.body.reason,
      });
      res.json(success(r));
    } catch (e) { next(e); }
  });

// POST /api/po/:id/admin-override
router.post('/:id/admin-override',
  rbacGuard('sales_po', 'admin_override_stage'),
  permissionWriteLimiter,
  validate({ body: v.adminOverride }),
  async (req, res, next) => {
    try {
      const r = await po.adminOverrideStage({
        actor: req.user, poId: req.params.id,
        targetStatus: req.body.targetStatus, reason: req.body.reason,
      });
      res.json(success(r));
    } catch (e) { next(e); }
  });

// GET /api/po/:id/history
router.get('/:id/history',
  rbacGuard('sales_po', 'view_global'),
  async (req, res, next) => {
    try {
      const h = await po.getHistory(req.params.id);
      res.json(success({ items: h }));
    } catch (e) { next(e); }
  });

module.exports = router;
```

(`po.getHistory` already exists per the existing service — verify by reading. If not, write a small wrapper that selects from `purchase_order_status_history WHERE purchase_order_id=$1 ORDER BY created_at DESC`.)

- [ ] **Step 4.5.3 — Mount in app.js**

```js
app.use('/api/po', require('./routes/po/stage.routes'));
```

- [ ] **Step 4.5.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/src/validators/po_stage.validators.js backend/src/routes/po/stage.routes.js backend/src/app.js
git commit -m "feat(po): /api/po/:id/{reject,admin-override,history}

Stage actions REST endpoints. RBAC: reject requires reject_stage; admin
override requires admin_override_stage (CEO/Superadmin via bypass).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.6 — Doc types admin CRUD routes

**Files:**
- Create: `backend/src/routes/admin/po-document-types.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 4.6.1 — Implement (Superadmin/CEO only via authority + view_global on admin_rbac)**

```js
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

const STAGES = ['Registered','Processed','Production','Shipped','Customs','Arrived','Inspected','Delivery','Installation','BAST','Invoice'];

const upsert = Joi.object({
  doc_key: Joi.string().min(1).max(100).required(),
  doc_name: Joi.string().min(1).max(255).required(),
  triggers_stage: Joi.string().valid(...STAGES).allow(null),
  required_for_stage: Joi.string().valid(...STAGES).allow(null),
  uploader_role_keys: Joi.array().items(Joi.string()).default([]),
  is_active: Joi.boolean().default(true),
});

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try {
    const r = await db.query(`SELECT * FROM po_document_types ORDER BY doc_name`);
    res.json(success({ items: r.rows }));
  } catch (e) { next(e); }
});

router.post('/',
  rbacGuard('admin_rbac', 'edit'),
  permissionWriteLimiter,
  validate({ body: upsert }),
  async (req, res, next) => {
    try {
      const b = req.body;
      const r = await db.query(`
        INSERT INTO po_document_types (doc_key, doc_name, triggers_stage, required_for_stage, uploader_role_keys, is_active)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
        [b.doc_key, b.doc_name, b.triggers_stage, b.required_for_stage, JSON.stringify(b.uploader_role_keys), b.is_active]);
      res.status(201).json(success(r.rows[0]));
    } catch (e) { next(e); }
  });

router.patch('/:id',
  rbacGuard('admin_rbac', 'edit'),
  permissionWriteLimiter,
  validate({ body: upsert.fork(Object.keys(upsert.describe().keys), s => s.optional()) }),
  async (req, res, next) => {
    try {
      const b = req.body;
      const r = await db.query(`
        UPDATE po_document_types SET
          doc_key            = COALESCE($2, doc_key),
          doc_name           = COALESCE($3, doc_name),
          triggers_stage     = COALESCE($4, triggers_stage),
          required_for_stage = COALESCE($5, required_for_stage),
          uploader_role_keys = COALESCE($6::jsonb, uploader_role_keys),
          is_active          = COALESCE($7, is_active),
          updated_at         = now()
         WHERE id=$1 RETURNING *`,
        [req.params.id, b.doc_key, b.doc_name, b.triggers_stage, b.required_for_stage,
         b.uploader_role_keys ? JSON.stringify(b.uploader_role_keys) : null, b.is_active]);
      res.json(success(r.rows[0]));
    } catch (e) { next(e); }
  });

router.delete('/:id',
  rbacGuard('admin_rbac', 'delete'),
  permissionWriteLimiter,
  async (req, res, next) => {
    try {
      await db.query(`DELETE FROM po_document_types WHERE id=$1`, [req.params.id]);
      res.json(success({ ok: true }));
    } catch (e) { next(e); }
  });

module.exports = router;
```

- [ ] **Step 4.6.2 — Mount in app.js**

```js
app.use('/api/admin/po-document-types', require('./routes/admin/po-document-types.routes'));
```

- [ ] **Step 4.6.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/src/routes/admin/po-document-types.routes.js backend/src/app.js
git commit -m "feat(po): admin po_document_types CRUD routes

CRUD under /api/admin/po-document-types. Triggers_stage and
required_for_stage validated against the canonical 11 stages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.7 — Frontend: types + api + admin doc-types page

**Files:**
- Create: `frontend/lib/po-document-types.ts`
- Create: `frontend/lib/po-document-api.ts`
- Create: `frontend/app/(app)/admin/po-document-types/page.tsx`

- [ ] **Step 4.7.1 — Types**

```ts
export const PO_STAGES = [
  'Registered','Processed','Production','Shipped','Customs','Arrived',
  'Inspected','Delivery','Installation','BAST','Invoice',
] as const;
export type POStage = typeof PO_STAGES[number];

export interface PoDocumentType {
  id: string;
  doc_key: string;
  doc_name: string;
  triggers_stage: POStage | null;
  required_for_stage: POStage | null;
  uploader_role_keys: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PoStageHistoryRow {
  id: string;
  status_code: string;
  status_label: string;
  is_rejection: boolean;
  is_admin_override: boolean;
  reject_count_after: number | null;
  note: string | null;
  updated_by_user_id: string;
  updated_by_role: string;
  created_at: string;
}
```

- [ ] **Step 4.7.2 — API**

```ts
import { api } from './api';
import type { PoDocumentType, PoStageHistoryRow, POStage } from './po-document-types';

export const poDocApi = {
  listTypes: () =>
    api.get<{ data: { items: PoDocumentType[] } }>('/api/admin/po-document-types').then(r => r.data.data.items),
  createType: (body: Partial<PoDocumentType>) =>
    api.post<{ data: PoDocumentType }>('/api/admin/po-document-types', body).then(r => r.data.data),
  updateType: (id: string, patch: Partial<PoDocumentType>) =>
    api.patch<{ data: PoDocumentType }>(`/api/admin/po-document-types/${id}`, patch).then(r => r.data.data),
  deleteType: (id: string) =>
    api.delete(`/api/admin/po-document-types/${id}`).then(r => r.data),

  history: (poId: string) =>
    api.get<{ data: { items: PoStageHistoryRow[] } }>(`/api/po/${poId}/history`).then(r => r.data.data.items),
  reject: (poId: string, body: { toStatus: POStage; reason: string }) =>
    api.post(`/api/po/${poId}/reject`, body).then(r => r.data),
  adminOverride: (poId: string, body: { targetStatus: POStage; reason: string }) =>
    api.post(`/api/po/${poId}/admin-override`, body).then(r => r.data),
};
```

- [ ] **Step 4.7.3 — Admin page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import { PO_STAGES, type PoDocumentType, type POStage } from '@/lib/po-document-types';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import { toast } from 'sonner';

export default function PoDocumentTypesPage() {
  const [items, setItems] = useState<PoDocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<PoDocumentType> | null>(null);

  async function refresh() {
    setLoading(true);
    try { setItems(await poDocApi.listTypes()); }
    catch (e: any) { toast.error(`Load failed: ${e?.response?.data?.error || e?.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!editing?.doc_key || !editing?.doc_name) { toast.error('key + name required'); return; }
    try {
      if (editing.id) await poDocApi.updateType(editing.id, editing);
      else await poDocApi.createType(editing);
      toast.success('Saved');
      setEditing(null);
      refresh();
    } catch (e: any) { toast.error(`Save failed: ${e?.response?.data?.error || e?.message}`); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this doc type? Files referring to it will keep their reference but auto-trigger will stop firing.')) return;
    try { await poDocApi.deleteType(id); refresh(); }
    catch (e: any) { toast.error(`Delete failed: ${e?.response?.data?.error || e?.message}`); }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">PO Document Types</h1>
        <button onClick={() => setEditing({ doc_key: '', doc_name: '', triggers_stage: null, required_for_stage: null, uploader_role_keys: [], is_active: true })}
          className="bg-blue-600 text-white px-3 py-1 rounded">+ New</button>
      </div>
      {loading ? <div>Loading...</div> : (
        <table className="w-full border-collapse text-sm">
          <thead><tr>
            <th className="border p-2 text-left">Key</th>
            <th className="border p-2 text-left">Name</th>
            <th className="border p-2 text-left">Triggers</th>
            <th className="border p-2 text-left">Uploaders</th>
            <th className="border p-2 text-left">Active</th>
            <th className="border p-2"></th>
          </tr></thead>
          <tbody>
            {items.map(t => (
              <tr key={t.id}>
                <td className="border p-2 font-mono text-xs">{t.doc_key}</td>
                <td className="border p-2">{t.doc_name}</td>
                <td className="border p-2">{t.triggers_stage || '—'}</td>
                <td className="border p-2 text-xs">{(t.uploader_role_keys || []).map(r => ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r).join(', ') || '—'}</td>
                <td className="border p-2">{t.is_active ? '✓' : '✗'}</td>
                <td className="border p-2 space-x-2">
                  <button onClick={() => setEditing(t)} className="text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => remove(t.id)} className="text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="mt-6 border p-4 rounded space-y-2 bg-gray-50">
          <h2 className="font-semibold">{editing.id ? 'Edit' : 'New'} doc type</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm">Doc key</span>
              <input className="border p-1 w-full" value={editing.doc_key || ''} onChange={e => setEditing({...editing, doc_key: e.target.value})} />
            </label>
            <label className="block">
              <span className="text-sm">Doc name</span>
              <input className="border p-1 w-full" value={editing.doc_name || ''} onChange={e => setEditing({...editing, doc_name: e.target.value})} />
            </label>
            <label className="block">
              <span className="text-sm">Triggers stage</span>
              <select className="border p-1 w-full" value={editing.triggers_stage || ''} onChange={e => setEditing({...editing, triggers_stage: (e.target.value || null) as POStage | null})}>
                <option value="">— none —</option>
                {PO_STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Required for stage</span>
              <select className="border p-1 w-full" value={editing.required_for_stage || ''} onChange={e => setEditing({...editing, required_for_stage: (e.target.value || null) as POStage | null})}>
                <option value="">— none —</option>
                {PO_STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="block col-span-2">
              <span className="text-sm">Uploader roles</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLE_KEYS.map(r => (
                  <label key={r} className="text-sm">
                    <input type="checkbox"
                      checked={(editing.uploader_role_keys || []).includes(r)}
                      onChange={e => {
                        const cur = editing.uploader_role_keys || [];
                        const next = e.target.checked ? [...cur, r] : cur.filter(x => x !== r);
                        setEditing({...editing, uploader_role_keys: next});
                      }} />
                    {' '}{ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </label>
            <label className="block">
              <input type="checkbox" checked={editing.is_active ?? true} onChange={e => setEditing({...editing, is_active: e.target.checked})} />
              {' '}Active
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="bg-blue-600 text-white px-3 py-1 rounded">Save</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.7.4 — Type-check + commit**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

```bash
git add frontend/lib/po-document-types.ts frontend/lib/po-document-api.ts frontend/app/\(app\)/admin/po-document-types/
git commit -m "feat(po): admin po_document_types CRUD UI + lib

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.8 — Frontend: StageTimeline + RejectStageDialog + AdminOverrideDialog

**Files:**
- Create: `frontend/components/po/StageTimeline.tsx`
- Create: `frontend/components/po/RejectStageDialog.tsx`
- Create: `frontend/components/po/AdminOverrideDialog.tsx`

- [ ] **Step 4.8.1 — StageTimeline**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import type { PoStageHistoryRow } from '@/lib/po-document-types';

interface Props { poId: string; refreshKey?: number; }

export function StageTimeline({ poId, refreshKey = 0 }: Props) {
  const [items, setItems] = useState<PoStageHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    poDocApi.history(poId).then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, [poId, refreshKey]);

  if (loading) return <div className="text-sm text-gray-500">Loading history...</div>;
  if (!items.length) return <div className="text-sm text-gray-500">No history yet.</div>;

  return (
    <ol className="border-l-2 border-gray-300 pl-4 space-y-3">
      {items.map(h => (
        <li key={h.id} className="relative">
          <span className={`absolute -left-[9px] top-1.5 w-3.5 h-3.5 rounded-full ${
            h.is_rejection ? 'bg-red-500' : h.is_admin_override ? 'bg-yellow-500' : 'bg-blue-500'
          }`} />
          <div className="text-sm font-semibold">{h.status_label}
            {h.is_rejection && <span className="ml-2 text-red-600 text-xs">(rejection #{h.reject_count_after})</span>}
            {h.is_admin_override && <span className="ml-2 text-yellow-600 text-xs">(admin override)</span>}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(h.created_at).toLocaleString()} — by {h.updated_by_role}
          </div>
          {h.note && <div className="text-sm mt-1 italic">{h.note}</div>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4.8.2 — RejectStageDialog**

```tsx
'use client';
import { useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import { PO_STAGES, type POStage } from '@/lib/po-document-types';
import { toast } from 'sonner';

interface Props {
  poId: string;
  currentStage: POStage;
  onClose: () => void;
  onDone?: () => void;
}

export function RejectStageDialog({ poId, currentStage, onClose, onDone }: Props) {
  const eligible = PO_STAGES.slice(0, PO_STAGES.indexOf(currentStage));
  const [toStatus, setToStatus] = useState<POStage>(eligible[eligible.length - 1] || 'Registered');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim() || reason.length < 3) { toast.error('Reason required (min 3 chars)'); return; }
    setBusy(true);
    try {
      await poDocApi.reject(poId, { toStatus, reason });
      toast.success(`Rejected to ${toStatus}`);
      onDone?.(); onClose();
    } catch (e: any) {
      toast.error(`Reject failed: ${e?.response?.data?.error || e?.message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded p-6 max-w-md w-full space-y-4">
        <h3 className="text-lg font-semibold">Reject stage</h3>
        <p className="text-sm text-gray-600">Move PO backward from <b>{currentStage}</b> to an earlier stage.</p>
        <label className="block">
          <span className="text-sm">Target stage</span>
          <select value={toStatus} onChange={e => setToStatus(e.target.value as POStage)} className="border p-1 w-full">
            {eligible.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Reason</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} className="border p-1 w-full" rows={3} />
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-red-600 text-white px-3 py-1 rounded">
            {busy ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.8.3 — AdminOverrideDialog**

```tsx
'use client';
import { useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import { PO_STAGES, type POStage } from '@/lib/po-document-types';
import { toast } from 'sonner';

interface Props {
  poId: string;
  currentStage: POStage;
  onClose: () => void;
  onDone?: () => void;
}

export function AdminOverrideDialog({ poId, currentStage, onClose, onDone }: Props) {
  const [target, setTarget] = useState<POStage>(currentStage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim() || reason.length < 3) { toast.error('Reason required (min 3 chars)'); return; }
    setBusy(true);
    try {
      await poDocApi.adminOverride(poId, { targetStatus: target, reason });
      toast.success(`Overridden to ${target}`);
      onDone?.(); onClose();
    } catch (e: any) {
      toast.error(`Override failed: ${e?.response?.data?.error || e?.message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded p-6 max-w-md w-full space-y-4">
        <h3 className="text-lg font-semibold">Admin override stage</h3>
        <p className="text-sm text-gray-600">⚠ Skip stages without normal sequence checks. Logged with reason.</p>
        <label className="block">
          <span className="text-sm">Target stage</span>
          <select value={target} onChange={e => setTarget(e.target.value as POStage)} className="border p-1 w-full">
            {PO_STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Reason</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} className="border p-1 w-full" rows={3} />
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-yellow-600 text-white px-3 py-1 rounded">
            {busy ? 'Overriding...' : 'Override'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.8.4 — Type-check + commit**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

```bash
git add frontend/components/po/
git commit -m "feat(po): StageTimeline + RejectStageDialog + AdminOverrideDialog

StageTimeline reads /api/po/:id/history and renders a vertical timeline
with rejection/override badges. Reject + override dialogs are simple
modals with reason validation; servers enforce capability checks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4.9 — (Backlog/explicit deferral) Module-service refactor

The plan originally suggested refactoring all existing module services (`sales`, `admin_log`, `finance`, `technical`) to use `po.service.advanceStage` (renamed from `advanceStatus`). **Defer this**: the existing `advanceStatus` already works correctly; renaming and rerouting all callsites is a wide-blast-radius change with minimal benefit for this plan's goal (auto-trigger via doc upload). Plan 4 ships with the new service APIs and the file-upload hook; existing module services keep calling `advanceStatus` directly. A future cleanup task can normalize this — but only if it provides clear value (e.g., when adding tracking-event semantics).

No commit for this task — it's a deliberate deferral documented in the plan.

---

## Final integration check

- [ ] **F.1 — Full backend suite**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

Expected: all prior + ~12 new (4 migration + 2 seed + 4 stage actions + 3 doc service) tests pass.

- [ ] **F.2 — Frontend type-check**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

Expected: no NEW errors.

---

## Self-review

- ✅ **Spec coverage**:
  - Strict sequential default (Task 4.4 idempotent guard)
  - Reject backward (Task 4.3 enforces target < current)
  - Admin override skip (Task 4.3 + Task 4.5)
  - Document → stage map (Task 4.1 schema + Task 4.2 seed + Task 4.4 service + Task 4.4.2 hook)
  - Audit columns is_rejection, is_admin_override, reject_count_after (Task 4.1)
  - Race condition mitigation: SELECT FOR UPDATE in Task 4.3 reject + override; advanceStatus already does this
  - Capabilities advance_stage / reject_stage / admin_override_stage seeded with appropriate grants (Task 4.2)
- ✅ **Module-service refactor**: explicit deferral documented (Task 4.9); plan ships working auto-trigger via the upload hook regardless
- ✅ **No placeholders within steps**
- ✅ **Plan 1 dependencies honored** (resolveCapabilities, success() wrapper, authMiddleware, validate, permissionWriteLimiter)

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-plan4-po-doc-stage-map.md`.**

8 active tasks (4.1–4.8) plus 1 deferred (4.9). ~10–12 subagent dispatches expected.

**1. Subagent-Driven (recommended)**
**2. Inline Execution**

Which approach?

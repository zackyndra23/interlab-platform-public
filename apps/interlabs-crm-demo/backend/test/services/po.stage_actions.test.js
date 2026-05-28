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
        (po_number, current_status, customer_id, created_by_user_id, updated_by_user_id,
         created_by_role, updated_by_role)
      VALUES ($1, 'Inspected',
        (SELECT id FROM customers LIMIT 1),
        $2, $2, 'sales', 'sales')
      RETURNING id`, [`TEST-PO-${Date.now()}`, salesUserId]);
    fixturePoId = ins.rows[0].id;
  }
});

afterAll(async () => {
  if (fixturePoId) {
    await pool.query(`DELETE FROM purchase_order_status_history WHERE po_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_order_tracking_events WHERE po_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM notifications WHERE related_entity_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM po_customer_records WHERE related_po_id=$1`, [fixturePoId]);
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
       WHERE po_id=$1 ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(hist.rows[0].is_rejection).toBe(true);
    expect(hist.rows[0].note).toMatch(/inspection failed/i);
    expect(hist.rows[0].status_code).toBe('ARRIVED');
  });

  it('creates a tracking_events row with event_type po.stage_rejected', async () => {
    if (!fixturePoId || !ceoId) return;
    // Do a fresh reject to check the event row
    await po.rejectStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      toStatus: 'Shipped',
      reason: 'second rejection check',
    });
    const ev = await pool.query(`
      SELECT event_type, payload_json FROM purchase_order_tracking_events
       WHERE po_id=$1 AND event_type='po.stage_rejected'
       ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(ev.rowCount).toBeGreaterThan(0);
    expect(ev.rows[0].event_type).toBe('po.stage_rejected');
    const payload = ev.rows[0].payload_json;
    expect(payload.kind).toBe('reject');
    expect(payload.to).toBe('Shipped');
  });

  it('syncs po_customer_records.current_po_status on reject (C2)', async () => {
    if (!fixturePoId || !ceoId) return;
    // Ensure a po_customer_records row exists linked to this PO.
    // po_customer_records requires po_customer_record_number (NOT NULL).
    await pool.query(`
      INSERT INTO po_customer_records
        (po_customer_record_number, related_po_id, current_po_status, workflow_status,
         created_by, updated_by)
      VALUES ($1, $2, 'Shipped', 'active', $3, $3)
      ON CONFLICT (po_customer_record_number) DO NOTHING`,
      [`PCTEST-${Date.now()}`, fixturePoId, ceoId],
    );

    // Reject to Processed
    await po.rejectStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      toStatus: 'Processed',
      reason: 'mirror sync check',
    });

    const mirror = await pool.query(
      `SELECT current_po_status FROM po_customer_records WHERE related_po_id=$1 AND deleted_at IS NULL`,
      [fixturePoId],
    );
    // If a po_customer_records row exists, it must be in sync.
    if (mirror.rowCount > 0) {
      expect(mirror.rows[0].current_po_status).toBe('Processed');
    }
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

  it('throws on soft-deleted PO (C4)', async () => {
    if (!ceoId) return;
    // Insert and immediately soft-delete a PO
    const ins = await pool.query(`
      INSERT INTO purchase_orders
        (po_number, current_status, customer_id, created_by_user_id, updated_by_user_id,
         created_by_role, updated_by_role, deleted_at)
      VALUES ($1, 'Inspected', (SELECT id FROM customers LIMIT 1),
              $2, $2, 'sales', 'sales', now())
      RETURNING id`, [`SOFT-DEL-PO-${Date.now()}`, ceoId]);
    const softPoId = ins.rows[0].id;
    try {
      await expect(po.rejectStage({
        actor: { id: ceoId, role: 'ceo' },
        poId: softPoId,
        toStatus: 'Processed',
        reason: 'should fail',
      })).rejects.toThrow(/not found or deleted/i);
    } finally {
      await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [softPoId]);
    }
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
       WHERE po_id=$1 ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(hist.rows[0].is_admin_override).toBe(true);
    expect(hist.rows[0].note).toMatch(/expedite/i);
  });

  it('creates a tracking_events row with event_type po.stage_admin_overridden', async () => {
    if (!fixturePoId || !ceoId) return;
    await po.adminOverrideStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      targetStatus: 'Invoice',
      reason: 'override tracking event check',
    });
    const ev = await pool.query(`
      SELECT event_type, payload_json FROM purchase_order_tracking_events
       WHERE po_id=$1 AND event_type='po.stage_admin_overridden'
       ORDER BY created_at DESC LIMIT 1`, [fixturePoId]);
    expect(ev.rowCount).toBeGreaterThan(0);
    const payload = ev.rows[0].payload_json;
    expect(payload.kind).toBe('override');
    expect(payload.to).toBe('Invoice');
  });

  it('syncs po_customer_records.current_po_status on override (C2)', async () => {
    if (!fixturePoId || !ceoId) return;
    // Override to Registered
    await po.adminOverrideStage({
      actor: { id: ceoId, role: 'ceo' },
      poId: fixturePoId,
      targetStatus: 'Registered',
      reason: 'mirror sync override check',
    });

    const mirror = await pool.query(
      `SELECT current_po_status FROM po_customer_records WHERE related_po_id=$1 AND deleted_at IS NULL`,
      [fixturePoId],
    );
    if (mirror.rowCount > 0) {
      expect(mirror.rows[0].current_po_status).toBe('Registered');
    }
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

  it('throws on soft-deleted PO (C4)', async () => {
    if (!ceoId) return;
    const ins = await pool.query(`
      INSERT INTO purchase_orders
        (po_number, current_status, customer_id, created_by_user_id, updated_by_user_id,
         created_by_role, updated_by_role, deleted_at)
      VALUES ($1, 'Inspected', (SELECT id FROM customers LIMIT 1),
              $2, $2, 'sales', 'sales', now())
      RETURNING id`, [`SOFT-DEL-OVRD-${Date.now()}`, ceoId]);
    const softPoId = ins.rows[0].id;
    try {
      await expect(po.adminOverrideStage({
        actor: { id: ceoId, role: 'ceo' },
        poId: softPoId,
        targetStatus: 'Invoice',
        reason: 'should fail',
      })).rejects.toThrow(/not found or deleted/i);
    } finally {
      await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [softPoId]);
    }
  });
});

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
      INSERT INTO purchase_orders
        (po_number, current_status, customer_id, created_by_user_id, updated_by_user_id,
         created_by_role, updated_by_role)
      VALUES ($1, 'Processed', (SELECT id FROM customers LIMIT 1), $2, $2, 'sales', 'sales')
      RETURNING id`, [`PO-DOC-TEST-${Date.now()}`, salesUserId]);
    fixturePoId = r.rows[0].id;
  }
});

afterAll(async () => {
  if (fixturePoId) {
    await pool.query(`DELETE FROM purchase_order_status_history WHERE po_id=$1`, [fixturePoId]);
    await pool.query(`DELETE FROM purchase_order_tracking_events WHERE po_id=$1`, [fixturePoId]);
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

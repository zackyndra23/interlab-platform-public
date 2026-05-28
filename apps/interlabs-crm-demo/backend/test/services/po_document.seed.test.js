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

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

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

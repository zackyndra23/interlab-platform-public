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
    await pool.query(`DELETE FROM invoice_customers WHERE related_po_id=$1`, [poId]);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [poId]);
  });
});

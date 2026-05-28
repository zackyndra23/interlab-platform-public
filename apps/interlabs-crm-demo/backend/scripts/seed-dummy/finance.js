'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const POC_WF = ['registered','active','invoiced','completed'];
const IM_PAY = ['Unpaid','Paid'];

async function seedFinance(manifest) {
  await db.withTransaction(async (client) => {
    const pos = manifest.poIds || [], cust = manifest.customerIds || [];
    const pickPo = (i) => pos.length ? pos[i % pos.length] : null;
    const pickCust = (i) => cust.length ? cust[i % cust.length] : null;

    const N1 = 16, pwf = L.spreadStatuses(POC_WF, N1);
    for (let i = 0; i < N1; i++) {
      const total = 60_000_000 + (i % 7) * 20_000_000;
      const r = await client.query(
        `INSERT INTO po_customer_records (po_customer_record_number, workflow_status, current_po_status, related_po_id, customer_id, subtotal, tax_amount, total_amount, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()-($9||' days')::interval) RETURNING id`,
        [fmt('POC', i+1), pwf[i], pwf[i] === 'completed' ? 'Invoice' : 'Production', pickPo(i), pickCust(i),
         Math.round(total/1.11), Math.round(total - total/1.11), total, i*2]);
      manifest.poCustomerIds.push(r.rows[0].id);
    }
    const N2 = 12, ipay = L.spreadStatuses(IM_PAY, N2);
    for (let i = 0; i < N2; i++) {
      const total = 30_000_000 + (i % 6) * 18_000_000, paid = ipay[i] === 'Paid';
      const r = await client.query(
        `INSERT INTO invoice_manufactures (invoice_manufacture_record_number, payment_status, payment_date, payment_amount, related_po_id, total_amount, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now()-($7||' days')::interval) RETURNING id`,
        [fmt('IM', i+1), ipay[i], paid ? new Date() : null, paid ? total : null, pickPo(i), total, i*3]);
      manifest.invoiceManufactureIds.push(r.rows[0].id);
    }
    // ensure both status values exist on PO-derived demo rows (po.js made them all 'Processed')
    const ic = await client.query(`SELECT id FROM invoice_customers WHERE invoice_customer_record_number LIKE 'INV-DEMO-%' ORDER BY created_at`);
    for (let i = 0; i < ic.rows.length; i++) if (i % 2 === 0) await client.query(`UPDATE invoice_customers SET invoice_status='Registered' WHERE id=$1`, [ic.rows[i].id]);
    const pr = await client.query(`SELECT id FROM purchase_requisitions WHERE pr_record_number LIKE 'PR-DEMO-%' ORDER BY created_at`);
    for (let i = 0; i < pr.rows.length; i++) if (i % 2 === 0) await client.query(`UPDATE purchase_requisitions SET current_pr_status='Registered' WHERE id=$1`, [pr.rows[i].id]);
  });
}
module.exports = { seedFinance };

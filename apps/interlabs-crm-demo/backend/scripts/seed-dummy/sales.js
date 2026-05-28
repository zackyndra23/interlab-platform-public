'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const QUOTE_WF = ['draft','submitted','revised','accepted','rejected'];
const SPO_WF = ['draft','submitted','processed','overdue'];
const STEP = ['on_track','overdue'];
const FC_STAGE = ['Prospect','Qualified','Proposal','Negotiation','Won','Lost'];
const FC_WF = ['draft','submitted','closed'];
const HPP_WF = ['draft','submitted','approved'];
const PR_WF = ['draft','submitted','copied_to_finance'];

async function seedSales(manifest) {
  await db.withTransaction(async (client) => {
    const cust = manifest.customerIds || [];
    const pick = (i) => cust.length ? cust[i % cust.length] : null;

    const q = await client.query(`SELECT id FROM quotations WHERE quotation_record_number LIKE 'QT-DEMO-%' ORDER BY created_at`);
    const qwf = L.spreadStatuses(QUOTE_WF, q.rows.length);
    for (let i = 0; i < q.rows.length; i++)
      await client.query(`UPDATE quotations SET workflow_status=$1 WHERE id=$2`, [qwf[i], q.rows[i].id]);

    const sp = await client.query(`SELECT id FROM sales_purchase_orders WHERE po_record_number LIKE 'PO-SO-DEMO-%' ORDER BY created_at`);
    const swf = L.spreadStatuses(SPO_WF, sp.rows.length), sst = L.spreadStatuses(STEP, sp.rows.length);
    for (let i = 0; i < sp.rows.length; i++)
      await client.query(`UPDATE sales_purchase_orders SET workflow_status=$1, step_status=$2 WHERE id=$3`, [swf[i], sst[i], sp.rows[i].id]);

    const N1 = 18, stg = L.spreadStatuses(FC_STAGE, N1), fwf = L.spreadStatuses(FC_WF, N1), fst = L.spreadStatuses(STEP, N1);
    for (let i = 0; i < N1; i++) {
      const r = await client.query(
        `INSERT INTO sales_forecasts (forecast_record_number, product_or_service_name, stage, workflow_status, step_status, estimated_value, customer_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now()-($8||' days')::interval) RETURNING id`,
        [fmt('SF', i+1), `Produk/Jasa ${i+1}`, stg[i], fwf[i], fst[i], 50_000_000+(i%8)*30_000_000, pick(i), i*2]);
      manifest.salesForecastIds.push(r.rows[0].id);
    }
    const N2 = 9, hwf = L.spreadStatuses(HPP_WF, N2);
    for (let i = 0; i < N2; i++) {
      const cost = 40_000_000+(i%6)*15_000_000, sell = Math.round(cost*1.3);
      const r = await client.query(
        `INSERT INTO harga_pokok_penjualan (hpp_record_number, workflow_status, total_cost, total_selling_price, gross_margin_total, customer_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now()-($7||' days')::interval) RETURNING id`,
        [fmt('HPP', i+1), hwf[i], cost, sell, sell-cost, pick(i), i*3]);
      manifest.hppIds.push(r.rows[0].id);
    }
    const N3 = 9, pwf = L.spreadStatuses(PR_WF, N3);
    for (let i = 0; i < N3; i++) {
      const r = await client.query(
        `INSERT INTO purchase_requests_sales (pr_record_number, workflow_status, created_at)
         VALUES ($1,$2, now()-($3||' days')::interval) RETURNING id`,
        [fmt('SPR', i+1), pwf[i], i*2]);
      manifest.salesPrIds.push(r.rows[0].id);
    }
  });
}
module.exports = { seedSales };

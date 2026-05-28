'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const AWB_ST = ['Registered','Processed','Arrived'];
const DO_ST = ['Registered','Arrived'];
const EXP = ['Pending','Paid','Cancelled'];
const OPS_WF = ['draft','submitted','reviewed'];
const CATS = ['Logistik','ATK','Operasional','Transport'];

async function seedAdminlog(manifest) {
  await db.withTransaction(async (client) => {
    const pos = manifest.poIds || [];
    const pick = (i) => pos.length ? pos[i % pos.length] : null;
    const NA = 6, ast = L.spreadStatuses(AWB_ST, NA);
    for (let i = 0; i < NA; i++)
      await client.query(`INSERT INTO awb_records (awb_record_number, related_po_id, current_awb_status, created_at)
        VALUES ($1,$2,$3, now()-($4||' days')::interval)`, [fmt('AWBX', i+1), pick(i), ast[i], i]);
    const ND = 4, dst = L.spreadStatuses(DO_ST, ND);
    for (let i = 0; i < ND; i++)
      await client.query(`INSERT INTO delivery_orders (do_record_number, related_po_id, current_do_status, created_at)
        VALUES ($1,$2,$3, now()-($4||' days')::interval)`, [fmt('DOX', i+1), pick(i), dst[i], i]);
    const NO = 18, ex = L.spreadStatuses(EXP, NO), wf = L.spreadStatuses(OPS_WF, NO);
    for (let i = 0; i < NO; i++) {
      const r = await client.query(
        `INSERT INTO admin_operational_records (operational_record_number, reporting_month, expense_status, workflow_status, amount, expense_category, created_at)
         VALUES ($1, (date_trunc('month', now()) - (($2)||' months')::interval)::date, $3,$4,$5,$6, now()-($7||' days')::interval) RETURNING id`,
        [fmt('OPS', i+1), i % 4, ex[i], wf[i], 5_000_000 + (i % 6) * 2_000_000, CATS[i % 4], i]);
      manifest.operationalIds.push(r.rows[0].id);
    }
  });
}
module.exports = { seedAdminlog };

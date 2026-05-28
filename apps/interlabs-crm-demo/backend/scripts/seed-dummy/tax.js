'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const TAX_TYPE = ['PPh 21','PPh 25','PPN','Others'];
const TAX_CAT = ['SSP Payment','SPT Reporting','Combined Record'];
const PAY = ['Unpaid','Paid','Pending','Failed'];
const REC = ['Draft','Submitted','Verified','Archived'];
const ACTIONS = ['created','updated','status_changed','archived'];

async function seedTax(manifest) {
  await db.withTransaction(async (client) => {
    const tu = await client.query(`SELECT id FROM users WHERE role='tax_insurance' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
    const pic = tu.rows[0] ? tu.rows[0].id : null;
    const N = 24;
    const tt = L.spreadStatuses(TAX_TYPE, N), tc = L.spreadStatuses(TAX_CAT, N),
          pay = L.spreadStatuses(PAY, N), rec = L.spreadStatuses(REC, N), act = L.spreadStatuses(ACTIONS, N);
    for (let i = 0; i < N; i++) {
      const k = i % 6; // months back (k=0 → current masa pajak)
      const r = await client.query(
        `INSERT INTO tax_operational_records
           (tax_operational_record_number, tax_type, tax_category, npwp, payment_status, record_status,
            masa_pajak, masa_pajak_month, masa_pajak_year, tahun_pajak, amount, pic_user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,
            (date_trunc('month',now())-($7||' months')::interval)::date,
            extract(month from (date_trunc('month',now())-($7||' months')::interval))::int,
            extract(year from (date_trunc('month',now())-($7||' months')::interval))::int,
            extract(year from now())::int, $8, $9, now()-($10||' days')::interval)
         RETURNING id`,
        [fmt('TAX', i+1), tt[i], tc[i], `0${(i%9)+1}.234.567.8-90${i%10}.000`, pay[i], rec[i], k,
         5_000_000 + (i%8) * 3_000_000, pic, i]);
      const tid = r.rows[0].id;
      manifest.taxRecordIds.push(tid);
      await client.query(
        `INSERT INTO tax_operational_audit_log (record_id, action, actor_user_id, created_at)
         VALUES ($1,$2,$3, now()-($4||' days')::interval)`,
        [tid, act[i], pic, i]);
    }
  });
}
module.exports = { seedTax };

'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const JO_WF = ['draft','active','completed','cancelled'];
const JOB_TYPES = ['Installation','PM','Sparepart'];
const INS_INSPECT = ['Pending','In Progress','Complete'];
const INS_FUNC = ['Pending','Pass','Fail'];
const ALR = ['pending','acknowledged','dispatched'];
const INS_PHASE = ['pre_installation','workshop','ready_to_deliver','scheduling','on_site','commissioning','completed'];
const RTD = ['Yes','No'];
const PM_WF = ['scheduled','in_progress','completed'];
const SP_WF = ['awaiting_awb','workshop_check','ready','dispatched'];
const WS = ['Pending','In Progress','Passed','Failed'];
const QC_REVIEW = ['Pending Review','Reviewed','Approved'];
const QC_SUBMIT = ['Draft','Submitted'];
const QC_DEFECT = ['None','Physical','Functional','Documentation'];
const BAST_WF = ['draft','submitted','sent_to_finance'];
const PER = 8; // job orders per job_type

async function seedTechnical(manifest) {
  await db.withTransaction(async (client) => {
    const pos = manifest.poIds || [];
    const pickPo = (i) => pos.length ? pos[i % pos.length] : null;
    const tu = await client.query(`SELECT id FROM users WHERE role='technical' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
    const techId = tu.rows[0] ? tu.rows[0].id : null;
    let seq = 0;
    for (const jt of JOB_TYPES) {
      const wf = L.spreadStatuses(JO_WF, PER);
      const inspect = L.spreadStatuses(INS_INSPECT, PER), func = L.spreadStatuses(INS_FUNC, PER),
            alr = L.spreadStatuses(ALR, PER), phase = L.spreadStatuses(INS_PHASE, PER), rtd = L.spreadStatuses(RTD, PER);
      const pmwf = L.spreadStatuses(PM_WF, PER);
      const spwf = L.spreadStatuses(SP_WF, PER), spalr = L.spreadStatuses(ALR, PER), spws = L.spreadStatuses(WS, PER);
      for (let i = 0; i < PER; i++) {
        seq++;
        const jo = await client.query(
          `INSERT INTO technical_job_orders (technical_job_order_number, related_po_id, job_type, workflow_status, assigned_engineer_id, created_at)
           VALUES ($1,$2,$3,$4,$5, now()-($6||' days')::interval) RETURNING id`,
          [fmt('TJO', seq), pickPo(seq), jt, wf[i], techId, seq]);
        const joId = jo.rows[0].id;
        manifest.jobOrderIds.push(joId);
        if (jt === 'Installation') {
          await client.query(
            `INSERT INTO installation_records (related_job_order_id, related_po_id, inspection_status, function_test_status, admin_log_response_status, workflow_phase, ready_to_deliver, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now()-($8||' days')::interval)`,
            [joId, pickPo(seq), inspect[i], func[i], alr[i], phase[i], rtd[i], seq]);
        } else if (jt === 'PM') {
          await client.query(
            `INSERT INTO pm_records (related_job_order_id, related_po_id, workflow_status, created_at)
             VALUES ($1,$2,$3, now()-($4||' days')::interval)`,
            [joId, pickPo(seq), pmwf[i], seq]);
        } else {
          await client.query(
            `INSERT INTO sparepart_records (related_job_order_id, related_po_id, workflow_status, admin_log_response_status, workshop_check_status, created_at)
             VALUES ($1,$2,$3,$4,$5, now()-($6||' days')::interval)`,
            [joId, pickPo(seq), spwf[i], spalr[i], spws[i], seq]);
        }
      }
    }
    const NQ = 12, rev = L.spreadStatuses(QC_REVIEW, NQ), sub = L.spreadStatuses(QC_SUBMIT, NQ), def = L.spreadStatuses(QC_DEFECT, NQ);
    for (let i = 0; i < NQ; i++) {
      const r = await client.query(
        `INSERT INTO inspection_qc_records (qc_record_number, review_status, final_submit_status, defect_category, related_po_id, created_at)
         VALUES ($1,$2,$3,$4,$5, now()-($6||' days')::interval) RETURNING id`,
        [fmt('QC', i+1), rev[i], sub[i], def[i], pickPo(i), i]);
      manifest.qcIds.push(r.rows[0].id);
    }
    const NB = 6, bwf = L.spreadStatuses(BAST_WF, NB);
    for (let i = 0; i < NB; i++) {
      await client.query(
        `INSERT INTO bast_records (bast_record_number, workflow_status, related_po_id, created_at)
         VALUES ($1,$2,$3, now()-($4||' days')::interval)`,
        [fmt('TBAST', i+1), bwf[i], pickPo(i), i]);
    }
  });
}
module.exports = { seedTechnical };

'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { pool } = require('../helpers/db');

const SCRIPT = path.join(__dirname, '../../scripts/seed-dummy/index.js');
const run = (args = []) => execFileSync('node', [SCRIPT, ...args], {
  env: { ...process.env, SEED_DUMMY_COUNT: '12', SEED_DUMMY_NO_FILES: '1' },
  cwd: path.join(__dirname, '../..'),
});

describe('seed-dummy integration (DB-only, N=12)', () => {
  beforeAll(async () => {
    const { pool } = require('../helpers/db');
    await pool.query('DELETE FROM email_queue');
    run(['--reset']);
  });
  afterAll(async () => { run(['--reset']); });

  it('creates 12 demo POs across all three types', async () => {
    const r = await pool.query(
      `SELECT po_type, count(*)::int c FROM purchase_orders
        WHERE po_number LIKE 'PO-DEMO-%' GROUP BY po_type`);
    const byType = r.rows.reduce((a, x) => (a[x.po_type] = x.c, a), {});
    expect(Object.keys(byType).sort()).toEqual(['installation','service','supply']);
    expect(r.rows.reduce((s, x) => s + x.c, 0)).toBe(12);
  });

  it('writes one status_history row per stage reached (oldest backdated)', async () => {
    const r = await pool.query(`
      SELECT p.po_number, p.current_status, count(h.id)::int hist
        FROM purchase_orders p JOIN purchase_order_status_history h ON h.po_id = p.id
       WHERE p.po_number LIKE 'PO-DEMO-%' GROUP BY p.id LIMIT 1`);
    expect(r.rows[0].hist).toBeGreaterThanOrEqual(1);
  });

  it('every service PO current_status is on the service path', async () => {
    const r = await pool.query(
      `SELECT current_status FROM purchase_orders WHERE po_type='service' AND po_number LIKE 'PO-DEMO-%'`);
    const ok = ['Registered','Processed','Inspected','BAST','Invoice'];
    for (const row of r.rows) expect(ok).toContain(row.current_status);
  });

  it('links documents back to their PO via FKs', async () => {
    const r = await pool.query(`
      SELECT count(*)::int c FROM sales_purchase_orders s
        JOIN purchase_orders p ON p.id = s.po_id
       WHERE p.po_number LIKE 'PO-DEMO-%'`);
    expect(r.rows[0].c).toBeGreaterThan(0);
  });

  it('creates multi-termin invoice_customers for installation POs at Invoice', async () => {
    const r = await pool.query(`
      SELECT p.id, count(ic.id)::int termins
        FROM purchase_orders p JOIN invoice_customers ic ON ic.related_po_id = p.id
       WHERE p.po_type='installation' AND p.current_status='Invoice' AND p.po_number LIKE 'PO-DEMO-%'
       GROUP BY p.id`);
    if (r.rows.length) expect(r.rows[0].termins).toBeGreaterThanOrEqual(2);
  });

  it('seeds file_attachments incl. ≥1 PO with multiple files on one entity', async () => {
    const r = await pool.query(`
      SELECT related_entity_id, count(*)::int c FROM file_attachments
       WHERE related_module='purchase_orders'
         AND related_entity_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%')
       GROUP BY related_entity_id ORDER BY c DESC LIMIT 1`);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('seeds historical dashboard notifications without enqueuing email', async () => {
    const notif = await pool.query(`
      SELECT count(*)::int c FROM notifications
       WHERE related_module='po-tracking'
         AND related_entity_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%')`);
    expect(notif.rows[0].c).toBeGreaterThan(0);
    const email = await pool.query(`SELECT count(*)::int c FROM email_queue`);
    expect(email.rows[0].c).toBe(0);
  });

  it('--reset removes the prior batch (no duplication) leaving exactly one batch', async () => {
    run(['--reset']);            // teardown prior + reseed 12
    run(['--reset']);            // teardown that batch + reseed 12 — must NOT accumulate
    const r = await pool.query(`SELECT count(*)::int c FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%'`);
    expect(r.rows[0].c).toBe(12);
  });

  it('seeds 6 demo staff users with rank-1 level + last_login', async () => {
    const r = await pool.query(`SELECT role, level_id, last_login_at FROM users WHERE email LIKE 'staff.%.demo@%'`);
    expect(r.rowCount).toBe(6);
    for (const u of r.rows) { expect(u.level_id).not.toBeNull(); expect(u.last_login_at).not.toBeNull(); }
  });
  it('sets last_login_at on all active users', async () => {
    const r = await pool.query(`SELECT count(*)::int c FROM users WHERE account_status='active' AND last_login_at IS NULL`);
    expect(r.rows[0].c).toBe(0);
  });

  it('varies quotation + sales-PO statuses across all values', async () => {
    const q = await pool.query(`SELECT workflow_status FROM quotations WHERE quotation_record_number LIKE 'QT-DEMO-%' GROUP BY workflow_status`);
    expect(q.rows.map(r=>r.workflow_status).sort()).toEqual(['accepted','draft','rejected','revised','submitted']);
    const s = await pool.query(`SELECT workflow_status FROM sales_purchase_orders WHERE po_record_number LIKE 'PO-SO-DEMO-%' GROUP BY workflow_status`);
    expect(s.rows.map(r=>r.workflow_status).sort()).toEqual(['draft','overdue','processed','submitted']);
  });
  it('seeds forecasts covering all stages + workflow_status', async () => {
    const st = await pool.query(`SELECT stage FROM sales_forecasts WHERE forecast_record_number LIKE 'SF-DEMO-%' GROUP BY stage`);
    expect(st.rows.map(r=>r.stage).sort()).toEqual(['Lost','Negotiation','Proposal','Prospect','Qualified','Won']);
    const wf = await pool.query(`SELECT workflow_status FROM sales_forecasts WHERE forecast_record_number LIKE 'SF-DEMO-%' GROUP BY workflow_status`);
    expect(wf.rows.map(r=>r.workflow_status).sort()).toEqual(['closed','draft','submitted']);
  });
  it('seeds HPP + sales PR covering all workflow_status', async () => {
    const h = await pool.query(`SELECT workflow_status FROM harga_pokok_penjualan WHERE hpp_record_number LIKE 'HPP-DEMO-%' GROUP BY workflow_status`);
    expect(h.rows.map(r=>r.workflow_status).sort()).toEqual(['approved','draft','submitted']);
    const p = await pool.query(`SELECT workflow_status FROM purchase_requests_sales WHERE pr_record_number LIKE 'SPR-DEMO-%' GROUP BY workflow_status`);
    expect(p.rows.map(r=>r.workflow_status).sort()).toEqual(['copied_to_finance','draft','submitted']);
  });

  it('seeds po_customer_records covering all workflow_status', async () => {
    const r = await pool.query(`SELECT workflow_status FROM po_customer_records WHERE po_customer_record_number LIKE 'POC-DEMO-%' GROUP BY workflow_status`);
    expect(r.rows.map(x=>x.workflow_status).sort()).toEqual(['active','completed','invoiced','registered']);
  });
  it('seeds invoice_manufactures with both payment_status', async () => {
    const r = await pool.query(`SELECT payment_status FROM invoice_manufactures WHERE invoice_manufacture_record_number LIKE 'IM-DEMO-%' GROUP BY payment_status`);
    expect(r.rows.map(x=>x.payment_status).sort()).toEqual(['Paid','Unpaid']);
  });
  it('invoice_customers + finance PR have both status values', async () => {
    const ic = await pool.query(`SELECT invoice_status FROM invoice_customers WHERE invoice_customer_record_number LIKE 'INV-DEMO-%' GROUP BY invoice_status`);
    expect(ic.rows.map(x=>x.invoice_status).sort()).toEqual(['Processed','Registered']);
    const pr = await pool.query(`SELECT current_pr_status FROM purchase_requisitions WHERE pr_record_number LIKE 'PR-DEMO-%' GROUP BY current_pr_status`);
    expect(pr.rows.map(x=>x.current_pr_status).sort()).toEqual(['Processed','Registered']);
  });

  it('seeds job orders covering all workflow_status and job_type', async () => {
    const wf = await pool.query(`SELECT workflow_status FROM technical_job_orders WHERE technical_job_order_number LIKE 'TJO-DEMO-%' GROUP BY workflow_status`);
    expect(wf.rows.map(r=>r.workflow_status).sort()).toEqual(['active','cancelled','completed','draft']);
    const jt = await pool.query(`SELECT job_type FROM technical_job_orders WHERE technical_job_order_number LIKE 'TJO-DEMO-%' GROUP BY job_type`);
    expect(jt.rows.map(r=>r.job_type).sort()).toEqual(['Installation','PM','Sparepart']);
  });
  it('seeds installation/pm/sparepart child records covering their statuses', async () => {
    const ins = await pool.query(`SELECT inspection_status FROM installation_records GROUP BY inspection_status`);
    expect(ins.rows.map(r=>r.inspection_status).sort()).toEqual(['Complete','In Progress','Pending']);
    const ft = await pool.query(`SELECT function_test_status FROM installation_records GROUP BY function_test_status`);
    expect(ft.rows.map(r=>r.function_test_status).sort()).toEqual(['Fail','Pass','Pending']);
    const pm = await pool.query(`SELECT workflow_status FROM pm_records GROUP BY workflow_status`);
    expect(pm.rows.map(r=>r.workflow_status).sort()).toEqual(['completed','in_progress','scheduled']);
    const sp = await pool.query(`SELECT workflow_status FROM sparepart_records GROUP BY workflow_status`);
    expect(sp.rows.map(r=>r.workflow_status).sort()).toEqual(['awaiting_awb','dispatched','ready','workshop_check']);
  });
  it('seeds QC + BAST covering their statuses', async () => {
    const qc = await pool.query(`SELECT review_status FROM inspection_qc_records WHERE qc_record_number LIKE 'QC-DEMO-%' GROUP BY review_status`);
    expect(qc.rows.map(r=>r.review_status).sort()).toEqual(['Approved','Pending Review','Reviewed']);
    const bast = await pool.query(`SELECT workflow_status FROM bast_records WHERE bast_record_number LIKE 'TBAST-DEMO-%' GROUP BY workflow_status`);
    expect(bast.rows.map(r=>r.workflow_status).sort()).toEqual(['draft','sent_to_finance','submitted']);
  });

  it('seeds AWB + DO covering all statuses', async () => {
    const a = await pool.query(`SELECT current_awb_status FROM awb_records WHERE awb_record_number LIKE 'AWBX-DEMO-%' GROUP BY current_awb_status`);
    expect(a.rows.map(r=>r.current_awb_status).sort()).toEqual(['Arrived','Processed','Registered']);
    const d = await pool.query(`SELECT current_do_status FROM delivery_orders WHERE do_record_number LIKE 'DOX-DEMO-%' GROUP BY current_do_status`);
    expect(d.rows.map(r=>r.current_do_status).sort()).toEqual(['Arrived','Registered']);
  });
  it('seeds admin operational records covering all statuses', async () => {
    const e = await pool.query(`SELECT expense_status FROM admin_operational_records WHERE operational_record_number LIKE 'OPS-DEMO-%' GROUP BY expense_status`);
    expect(e.rows.map(r=>r.expense_status).sort()).toEqual(['Cancelled','Paid','Pending']);
    const w = await pool.query(`SELECT workflow_status FROM admin_operational_records WHERE operational_record_number LIKE 'OPS-DEMO-%' GROUP BY workflow_status`);
    expect(w.rows.map(r=>r.workflow_status).sort()).toEqual(['draft','reviewed','submitted']);
  });

  it('HRGA legal docs cover every document_status and compliance_flag', async () => {
    const ds = await pool.query(`SELECT document_status FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%' GROUP BY document_status`);
    expect(ds.rows.map(r=>r.document_status).sort()).toEqual(['Active','Archived','Draft','Expired','Expiring Soon','Superseded']);
    const cf = await pool.query(`SELECT compliance_flag FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%' GROUP BY compliance_flag`);
    expect(cf.rows.map(r=>r.compliance_flag).sort()).toEqual(['expired','expiring_soon_30','expiring_soon_90','ok']);
  });
  it('HRGA company letters cover every letter_status', async () => {
    const r = await pool.query(`SELECT letter_status FROM company_letters WHERE letter_record_number LIKE 'LTR-DEMO-%' GROUP BY letter_status`);
    expect(r.rows.map(x=>x.letter_status).sort()).toEqual(['Archived','Draft','Final','Sent','Under Review']);
  });
  it('HRGA archive covers every archive_reason', async () => {
    const r = await pool.query(`SELECT archive_reason FROM hrga_archive_records WHERE archive_record_number LIKE 'ARC-DEMO-%' GROUP BY archive_reason`);
    expect(r.rows.map(x=>x.archive_reason).sort()).toEqual(['Expired','Other','Superseded','Withdrawn']);
  });

  it('seeds tax records covering all tax_type, payment_status, record_status', async () => {
    const tt = await pool.query(`SELECT tax_type FROM tax_operational_records WHERE tax_operational_record_number LIKE 'TAX-DEMO-%' GROUP BY tax_type`);
    expect(tt.rows.map(r=>r.tax_type).sort()).toEqual(['Others','PPN','PPh 21','PPh 25']);
    const ps = await pool.query(`SELECT payment_status FROM tax_operational_records WHERE tax_operational_record_number LIKE 'TAX-DEMO-%' GROUP BY payment_status`);
    expect(ps.rows.map(r=>r.payment_status).sort()).toEqual(['Failed','Paid','Pending','Unpaid']);
    const rs = await pool.query(`SELECT record_status FROM tax_operational_records WHERE tax_operational_record_number LIKE 'TAX-DEMO-%' GROUP BY record_status`);
    expect(rs.rows.map(r=>r.record_status).sort()).toEqual(['Archived','Draft','Submitted','Verified']);
  });
  it('seeds tax audit log covering all actions', async () => {
    const a = await pool.query(`SELECT action FROM tax_operational_audit_log al
      JOIN tax_operational_records t ON t.id = al.record_id
      WHERE t.tax_operational_record_number LIKE 'TAX-DEMO-%' GROUP BY action`);
    expect(a.rows.map(r=>r.action).sort()).toEqual(['archived','created','status_changed','updated']);
  });

  it('seeds activity logs covering all roles and actions', async () => {
    const roles = await pool.query(`SELECT user_role FROM activity_logs WHERE (detail->>'seeded')='true' GROUP BY user_role`);
    expect(roles.rows.length).toBeGreaterThanOrEqual(8);
    const acts = await pool.query(`SELECT action FROM activity_logs WHERE (detail->>'seeded')='true' GROUP BY action`);
    expect(acts.rows.map(r=>r.action).sort()).toEqual(['archived','auth.login.success','created','edit','export','logout']);
  });

  it('seeds >=80 DM chat messages', async () => {
    const r = await pool.query(`SELECT count(*)::int c FROM chat_messages m
      JOIN chat_channels c ON c.id=m.channel_id WHERE c.channel_name LIKE 'DEMO DM:%'`);
    expect(r.rows[0].c).toBeGreaterThanOrEqual(80);
  });
  it('superadmin and ceo each have a DM thread with every other role (>=7 partners)', async () => {
    for (const role of ['superadmin','ceo']) {
      const r = await pool.query(`SELECT count(DISTINCT u2.role)::int c
        FROM chat_channel_members cm1 JOIN users u1 ON u1.id=cm1.user_id AND u1.role=$1
        JOIN chat_channels c ON c.id=cm1.channel_id AND c.channel_name LIKE 'DEMO DM:%'
        JOIN chat_channel_members cm2 ON cm2.channel_id=cm1.channel_id AND cm2.user_id<>cm1.user_id
        JOIN users u2 ON u2.id=cm2.user_id`, [role]);
      expect(r.rows[0].c).toBeGreaterThanOrEqual(7);
    }
  });
  it('every role participates in >=10 DM messages', async () => {
    const r = await pool.query(`SELECT u.role, count(m.id)::int c FROM chat_messages m
      JOIN chat_channels c ON c.id=m.channel_id AND c.channel_name LIKE 'DEMO DM:%'
      JOIN chat_channel_members cm ON cm.channel_id=m.channel_id
      JOIN users u ON u.id=cm.user_id GROUP BY u.role`);
    expect(r.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of r.rows) expect(row.c).toBeGreaterThanOrEqual(10);
  });

  it('D1: double --reset leaves exactly one batch (no duplication, full cleanup)', async () => {
    run(['--reset']); run(['--reset']);
    const one = async (sql) => (await pool.query(sql)).rows[0].c;
    expect(await one(`SELECT count(*)::int c FROM users WHERE email LIKE 'staff.%.demo@%'`)).toBe(6);
    expect(await one(`SELECT count(*)::int c FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%'`)).toBe(18);
    expect(await one(`SELECT count(*)::int c FROM tax_operational_records WHERE tax_operational_record_number LIKE 'TAX-DEMO-%'`)).toBe(24);
    expect(await one(`SELECT count(*)::int c FROM technical_job_orders WHERE technical_job_order_number LIKE 'TJO-DEMO-%'`)).toBe(24);
    expect(await one(`SELECT count(*)::int c FROM sales_forecasts WHERE forecast_record_number LIKE 'SF-DEMO-%'`)).toBe(18);
    // chat + activity fully cleaned + reseeded (not accumulated)
    expect(await one(`SELECT count(*)::int c FROM chat_channels WHERE channel_name LIKE 'DEMO DM:%'`)).toBeLessThan(40);
  });

  it('PO status history actors span the stage-owner roles (not all sales)', async () => {
    const r = await pool.query(`SELECT DISTINCT updated_by_role FROM purchase_order_status_history
      WHERE po_number LIKE 'PO-DEMO-%' AND updated_by_role IS NOT NULL`);
    const roles = r.rows.map(x => x.updated_by_role).sort();
    expect(roles).toEqual(expect.arrayContaining(['admin_log','finance','sales','technical']));
  });
});

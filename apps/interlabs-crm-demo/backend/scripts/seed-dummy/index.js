'use strict';
// Manual dummy-data seeder. NOT wired into entrypoint.sh. Run on demand:
//   node scripts/seed-dummy/index.js            # seed (refuses if a batch exists)
//   node scripts/seed-dummy/index.js --reset    # tear down prior batch + S3 objects, then reseed
// Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md
const fs = require('fs');
const path = require('path');
const db = require('../../src/config/database');
const minio = require('../../src/config/minio');
const { seedPoFlow } = require('./po');

const NO_FILES = !!process.env.SEED_DUMMY_NO_FILES;
const MANIFEST = path.join(__dirname, '.manifest.json');

function loadManifest() {
    if (!fs.existsSync(MANIFEST)) return null;
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
function saveManifest(m) { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }

async function main() {
    const reset = process.argv.includes('--reset');
    const existing = loadManifest();
    if (existing && !reset) {
        throw new Error(`A dummy batch already exists (${existing.poIds.length} POs). Re-run with --reset.`);
    }
    if (reset) await teardown(existing); // Task 8

    const manifest = { createdAt: new Date().toISOString(), poIds: [], customerIds: [], s3Keys: [], demoUserIds: [], salesForecastIds: [], hppIds: [], salesPrIds: [], poCustomerIds: [], invoiceManufactureIds: [], jobOrderIds: [], qcIds: [], operationalIds: [], hrgaLegalIds: [], hrgaLetterIds: [], hrgaArchiveIds: [], taxRecordIds: [], chatChannelIds: [] };
    await require('./users').seedUsers(manifest); // Task 4 — users must exist before POs
    await seedPoFlow(manifest); // Tasks 5–7
    await require('./sales').seedSales(manifest); // Task 5 — varies statuses + seeds sales tables
    await require('./finance').seedFinance(manifest); // Task 6 — finance widgets
    await require('./technical').seedTechnical(manifest); // Task 7 — technical widgets
    await require('./adminlog').seedAdminlog(manifest); // Task 8 — AWB/DO/admin operational records
    await require('./hrga').seedHrga(manifest); // Task 9 — HRGA legal docs, company letters, archive
    await require('./tax').seedTax(manifest); // Task 10 — tax operational records + audit log
    await require('./activity').seedActivity(manifest); // Task 11 — activity logs for all roles
    await require('./chat').seedChat(manifest); // Task 12 — 1:1 DM chat bubbles
    saveManifest(manifest);
    console.log(`[seed-dummy] done: ${manifest.poIds.length} POs, ${manifest.s3Keys.length} S3 objects.`);
    await db.pool.end();
}

async function teardown(manifest) {
  // Remove S3 objects first (best-effort; skipped when files are disabled).
  if (manifest && Array.isArray(manifest.s3Keys) && manifest.s3Keys.length && !NO_FILES) {
    for (const { bucket, key } of manifest.s3Keys) {
      try { await minio.getClient().removeObject(bucket, key); }
      catch (e) { console.warn(`[seed-dummy] could not remove S3 object ${key}: ${e.message}`); }
    }
  }
  const poIds = (manifest && manifest.poIds) || [];
  await db.withTransaction(async (client) => {
    await client.query(`DELETE FROM tax_operational_records WHERE tax_operational_record_number LIKE 'TAX-DEMO-%'`);
    await client.query(`DELETE FROM hrga_archive_records WHERE archive_record_number LIKE 'ARC-DEMO-%'`);
    await client.query(`DELETE FROM company_letters WHERE letter_record_number LIKE 'LTR-DEMO-%'`);
    await client.query(`DELETE FROM hrga_legal_documents WHERE legal_document_record_number LIKE 'LGL-DEMO-%'`);
    await client.query(`DELETE FROM admin_operational_records WHERE operational_record_number LIKE 'OPS-DEMO-%'`);
    await client.query(`DELETE FROM inspection_qc_records WHERE qc_record_number LIKE 'QC-DEMO-%'`);
    await client.query(`DELETE FROM bast_records WHERE bast_record_number LIKE 'TBAST-DEMO-%'`);
    await client.query(`DELETE FROM technical_job_orders WHERE technical_job_order_number LIKE 'TJO-DEMO-%'`); // cascades installation/pm/sparepart
    await client.query(`DELETE FROM activity_logs WHERE (detail->>'seeded')='true'`);
    await client.query(`DELETE FROM chat_message_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id IN (SELECT id FROM chat_channels WHERE channel_name LIKE 'DEMO DM:%'))`);
    await client.query(`DELETE FROM chat_messages WHERE channel_id IN (SELECT id FROM chat_channels WHERE channel_name LIKE 'DEMO DM:%')`);
    await client.query(`DELETE FROM chat_channel_members WHERE channel_id IN (SELECT id FROM chat_channels WHERE channel_name LIKE 'DEMO DM:%')`);
    await client.query(`DELETE FROM chat_channels WHERE channel_name LIKE 'DEMO DM:%'`);
    await client.query(`DELETE FROM users WHERE email LIKE 'staff.%.demo@%'`);
    await client.query(`UPDATE users SET last_login_at = NULL WHERE account_status='active'`);
    // Always namespace-delete (all seeded POs are PO-DEMO-*), UNION any manifest ids.
    // Relying on the manifest alone is fragile: after an image rebuild the manifest
    // file is gone (or stale), which would silently skip the PO teardown.
    const nsIds = (await client.query(`SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-DEMO-%'`)).rows.map(r => r.id);
    const ids = [...new Set([...poIds, ...nsIds])];
    if (ids.length) {
      await client.query(`DELETE FROM file_attachments WHERE related_module='purchase_orders' AND related_entity_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM notifications WHERE related_module='po-tracking' AND related_entity_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM invoice_customers WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM bast_records WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM delivery_orders WHERE related_po_id = ANY($1)`, [ids]);  // RESTRICT → before PO
      await client.query(`DELETE FROM awb_records WHERE related_po_id = ANY($1)`, [ids]);       // RESTRICT → before PO
      await client.query(`DELETE FROM purchase_requisitions WHERE related_po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM sales_purchase_orders WHERE po_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [ids]); // cascades history + tracking
    }
    await client.query(`DELETE FROM sales_forecasts WHERE forecast_record_number LIKE 'SF-DEMO-%'`);
    await client.query(`DELETE FROM harga_pokok_penjualan WHERE hpp_record_number LIKE 'HPP-DEMO-%'`);
    await client.query(`DELETE FROM purchase_requests_sales WHERE pr_record_number LIKE 'SPR-DEMO-%'`);
    await client.query(`DELETE FROM quotations WHERE quotation_record_number LIKE 'QT-DEMO-%'`);
    await client.query(`DELETE FROM customers WHERE customer_record_number LIKE 'CUST-DEMO-%'`);
    await client.query(`DELETE FROM po_customer_records WHERE po_customer_record_number LIKE 'POC-DEMO-%'`);
    await client.query(`DELETE FROM invoice_manufactures WHERE invoice_manufacture_record_number LIKE 'IM-DEMO-%'`);
  });
  if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
}

main().catch((e) => { console.error('[seed-dummy] FAILED:', e.message); process.exit(1); });

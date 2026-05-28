'use strict';
const crypto = require('crypto');
const db = require('../../src/config/database');
const L = require('./lib');
const po = require('../../src/services/po.service');
const minio = require('../../src/config/minio');

const NO_FILES = !!process.env.SEED_DUMMY_NO_FILES;
const TINY_PDF = Buffer.from('%PDF-1.4\n%%EOF\n');   // placeholder bytes
const TINY_JPG = Buffer.from('ffd8ffd9', 'hex');     // minimal JPEG markers
// Title-case status → UPPERCASE status_code (status_history CHECK is uppercase).
const CODE = { Registered:'REGISTERED', Processed:'PROCESSED', Production:'PRODUCTION',
  Shipped:'SHIPPED', Customs:'CUSTOMS', Arrived:'ARRIVED', Inspected:'INSPECTED',
  Delivery:'DELIVERY', Installation:'INSTALLATION', BAST:'BAST', Invoice:'INVOICE' };

const STAGE_OWNER = { Registered:'sales', Processed:'sales', Production:'finance', Shipped:'admin_log',
  Customs:'admin_log', Arrived:'admin_log', Inspected:'technical', Delivery:'admin_log',
  Installation:'technical', BAST:'technical', Invoice:'finance' };

const PO_NAMESPACE = 'PO-DEMO'; // secondary marker if manifest is lost
const YEAR = 2026;
const TOTAL = Number(process.env.SEED_DUMMY_COUNT || 120);

async function pickActor(client, role) {
  const r = await client.query(
    `SELECT id, role FROM users WHERE role=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [role]);
  return r.rows[0]; // seeded by scripts/seed.js — one per role
}

async function seedCustomers(client, manifest, n) {
  const names = ['PT Maju Bersama','PT Sentosa Abadi','PT Karya Nusantara','CV Mitra Teknik',
    'PT Bumi Persada','PT Cahaya Medika','PT Sinar Laboratorium','PT Andalan Sains',
    'PT Global Instrumen','PT Riset Terpadu','PT Daya Anugerah','CV Solusi Presisi'];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const rec = L.formatRecordNumber('CUST', YEAR, i + 1).replace('CUST-', 'CUST-DEMO-');
    const r = await client.query(
      `INSERT INTO customers (customer_record_number, company_name, city, country, pic_name, customer_status)
       VALUES ($1,$2,'Jakarta','Indonesia',$3,'Active') RETURNING id`,
      [rec, names[i % names.length], `PIC ${i + 1}`]);
    ids.push(r.rows[0].id);
  }
  manifest.customerIds = ids;
  return ids;
}

async function seedPoFlow(manifest) {
  const types = L.planTypeDistribution(TOTAL);
  await db.withTransaction(async (client) => {
    const customers = await seedCustomers(client, manifest, Math.min(12, TOTAL));
    const sales = await pickActor(client, 'sales');
    const owners = {};
    for (const role of ['sales', 'finance', 'admin_log', 'technical']) owners[role] = await pickActor(client, role);
    for (let i = 0; i < types.length; i++) {
      const poType = types[i];
      const path = po.pathFor(poType);
      const target = path[i % path.length]; // spread targets across the whole path
      const poNumber = L.formatRecordNumber(PO_NAMESPACE, YEAR, i + 1);
      const created = new Date(Date.UTC(2026, 0, 1) + i * 36e5 * 24); // staggered ~1/day
      const timeline = L.buildTimeline(path, target, created);
      const last = timeline[timeline.length - 1];
      const customerId = customers[i % customers.length];
      const dueAt = new Date(last.at.getTime() + 7 * 864e5);

      const ins = await client.query(
        `INSERT INTO purchase_orders
           (po_number, po_type, current_status, created_by_user_id, created_by_role,
            updated_by_user_id, updated_by_role, customer_id, due_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'sales',$4,'sales',$5,$6,$7,$8) RETURNING id`,
        [poNumber, poType, last.status, sales.id, customerId, dueAt, created, last.at]);
      const poId = ins.rows[0].id;
      manifest.poIds.push(poId);

      for (const e of timeline) {
        const owner = owners[STAGE_OWNER[e.status]] || sales;
        await client.query(
          `INSERT INTO purchase_order_status_history
             (po_id, po_number, status_code, status_label, updated_by_user_id, updated_by_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [poId, poNumber, CODE[e.status], e.status, owner.id, owner.role, e.at]);
        await client.query(
          `INSERT INTO purchase_order_tracking_events (po_id, event_type, payload_json, created_at)
           VALUES ($1,'po.status_advanced',$2::jsonb,$3)`,
          [poId, JSON.stringify({ to: e.status, actor_role: owner.role, seeded: true }), e.at]);
      }
      await seedDocuments(client, manifest, { poId, poNumber, poType, path, target, customerId, timeline });
    }
  });
}

async function seedDocuments(client, manifest, ctx) {
  const { poId, poNumber, poType, path, target, customerId, timeline } = ctx;
  const idx = (s) => path.indexOf(s);
  const reached = (s) => idx(s) !== -1 && idx(s) <= idx(target);
  const atOf = (stage) => (timeline.find(e => e.status === stage) || timeline[timeline.length - 1]).at;
  const seq = nextSeq();
  const total = 50_000_000 + (seq % 10) * 25_000_000; // IDR, varied

  if (reached('Processed')) {
    const q = await client.query(
      `INSERT INTO quotations (quotation_record_number, customer_id, quotation_date, total_amount, workflow_status, created_at)
       VALUES ($1,$2,$3,$4,'accepted',$5) RETURNING id`,
      [L.formatRecordNumber('QT-DEMO', YEAR, seq), customerId, atOf('Registered'), total, atOf('Processed')]);
    await client.query(
      `INSERT INTO sales_purchase_orders (po_record_number, po_number, customer_id, related_quotation_id, po_id, total_amount, workflow_status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'processed',$7)`,
      [L.formatRecordNumber('PO-SO-DEMO', YEAR, seq), poNumber, customerId, q.rows[0].id, poId, total, atOf('Processed')]);
  }
  if (reached('Production') && poType !== 'service') {
    await client.query(
      `INSERT INTO purchase_requisitions (pr_record_number, related_po_id, customer_id, supplier_or_manufacturer, pr_date, current_pr_status, created_at)
       VALUES ($1,$2,$3,'PT Supplier Global',$4,'Processed',$5)`,
      [L.formatRecordNumber('PR-DEMO', YEAR, seq), poId, customerId, atOf('Production'), atOf('Production')]);
  }
  if (reached('Shipped') && poType !== 'service') {
    await client.query(
      `INSERT INTO awb_records (awb_record_number, related_po_id, related_po_number, customer_id, forwarder_or_courier, awb_tracking_number, shipment_method, current_awb_status, despatch_date, created_at)
       VALUES ($1,$2,$3,$4,'DHL Express',$5,'Air',$6,$7,$8)`,
      [L.formatRecordNumber('AWB-DEMO', YEAR, seq), poId, poNumber, customerId,
       `1Z${seq}${YEAR}`, reached('Arrived') ? 'Arrived' : 'Processed', atOf('Shipped'), atOf('Shipped')]);
  }
  if (reached('Delivery') && poType !== 'service') {
    await client.query(
      `INSERT INTO delivery_orders (do_record_number, related_po_id, related_po_number, customer_id, delivery_date, shipping_method, current_do_status, created_at)
       VALUES ($1,$2,$3,$4,$5,'Land','Arrived',$6)`,
      [L.formatRecordNumber('DO-DEMO', YEAR, seq), poId, poNumber, customerId, atOf('Delivery'), atOf('Delivery')]);
  }
  if (reached('BAST') && poType !== 'supply') {
    const tech = await pickActor(client, 'technical');
    await client.query(
      `INSERT INTO bast_records (bast_record_number, related_po_id, customer_id, job_type, completion_end_date, scope_summary, technical_pic_id, workflow_status, sent_to_finance, created_at)
       VALUES ($1,$2,$3,'Installation',$4,'Commissioning + training complete',$5,'sent_to_finance',true,$6)`,
      [L.formatRecordNumber('BAST-DEMO', YEAR, seq), poId, customerId, atOf('BAST'), tech ? tech.id : null, atOf('BAST')]);
  }
  if (reached('Invoice')) {
    const plan = L.terminPlanFor(poType, total);
    for (const t of plan) {
      const isFinal = t.sequence === plan.length;
      const paid = !isFinal || (seq % 3 !== 0);   // ~1/3 of finals left pending
      const dueDate = isFinal ? atOf('Invoice') : atOf('Processed');
      await client.query(
        `INSERT INTO invoice_customers
           (invoice_customer_record_number, related_po_id, customer_id, invoice_number, invoice_date,
            total_amount, amount, termin_sequence, termin_label, due_date, payment_status, paid_at, invoice_status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Processed',$13)`,
        [L.formatRecordNumber(`INV-DEMO-${t.sequence}`, YEAR, seq), poId, customerId,
         `INV/${YEAR}/${seq}/${t.sequence}`, dueDate, t.amount, t.amount, t.sequence, t.label,
         dueDate, paid ? 'paid' : 'pending', paid ? dueDate : null, dueDate]);
    }
  }
  await seedNotifications(client, ctx);
  if (reached('Inspected')) {
    await seedAttachment(client, manifest, { poId, filename: `inspection_${poNumber}.jpg`, mime: 'image/jpeg', buf: TINY_JPG, at: atOf('Inspected') });
  }
  if (reached('BAST') && poType !== 'supply') {
    await seedAttachment(client, manifest, { poId, filename: `bast_${poNumber}.pdf`, mime: 'application/pdf', buf: TINY_PDF, at: atOf('BAST') });
    await seedAttachment(client, manifest, { poId, filename: `bast_photo_${poNumber}.jpg`, mime: 'image/jpeg', buf: TINY_JPG, at: atOf('BAST') }); // multi-upload
  }
}

async function seedAttachment(client, manifest, { poId, filename, mime, buf, at }) {
  const fileId = crypto.randomUUID();
  const ext = filename.split('.').pop().toLowerCase();
  const bucket = minio.bucketAttachments;
  const key = `purchase_orders/${poId}/${fileId}_${filename}`;
  if (!NO_FILES) {
    await minio.getClient().putObject(bucket, key, buf, buf.length, { 'Content-Type': mime });
    manifest.s3Keys.push({ bucket, key });
  }
  await client.query(
    `INSERT INTO file_attachments
       (id, original_filename, mime_type, extension, related_module, related_entity_id,
        storage_bucket, storage_path, size_bytes, uploaded_at, created_at)
     VALUES ($1,$2,$3,$4,'purchase_orders',$5,$6,$7,$8,$9,$9)`,
    [fileId, filename, mime, ext, poId, bucket, key, buf.length, at]);
}

async function seedNotifications(client, ctx) {
  const { poId, poNumber, timeline } = ctx;
  for (const e of timeline) {
    const roles = po.STATUS_DEFAULT_RECIPIENTS[e.status] || [];
    if (!roles.length) continue;
    const users = await client.query(
      `SELECT id FROM users WHERE role = ANY($1) AND deleted_at IS NULL`, [roles]);
    for (const u of users.rows) {
      await client.query(
        `INSERT INTO notifications
           (title, message, recipient_user_id, related_module, related_entity_type, related_entity_id, is_read, created_at)
         VALUES ($1,$2,$3,'po-tracking','purchase_orders',$4,$5,$6)`,
        [`PO ${poNumber} → ${e.status}`, `Purchase order ${poNumber} advanced to ${e.status}.`,
         u.id, poId, Math.random() < 0.5, e.at]);
    }
  }
}

// Monotonic per-run counter for unique demo record numbers.
let _seq = 0;
function nextSeq() { return (_seq += 1); }

module.exports = { seedPoFlow };

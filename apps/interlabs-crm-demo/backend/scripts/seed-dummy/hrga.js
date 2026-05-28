'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const YEAR = 2026;
const fmt = (p, n) => L.formatRecordNumber(`${p}-DEMO`, YEAR, n);
const DOC_STATUS = ['Draft','Active','Expiring Soon','Expired','Superseded','Archived'];
const FLAG = ['ok','expiring_soon_90','expiring_soon_30','expired'];
const LETTER_STATUS = ['Draft','Under Review','Final','Sent','Archived'];
const ARCHIVE_REASON = ['Superseded','Expired','Withdrawn','Other'];

async function seedHrga(manifest) {
  await db.withTransaction(async (client) => {
    const docStatuses = L.spreadStatuses(DOC_STATUS, 18);
    const flags = L.spreadStatuses(FLAG, 18);
    for (let i = 0; i < 18; i++) {
      const flag = flags[i];
      const days = flag === 'expired' ? -30 : flag === 'expiring_soon_30' ? 20
        : flag === 'expiring_soon_90' ? 75 : 400;
      const r = await client.query(
        `INSERT INTO hrga_legal_documents
           (legal_document_record_number, document_name, document_status, compliance_flag,
            access_scope, expiry_date, created_at)
         VALUES ($1,$2,$3,$4,'hrga_only', (now() + ($5 || ' days')::interval)::date, now() - ($6 || ' days')::interval)
         RETURNING id`,
        [fmt('LGL', i + 1), `Izin/Legal Doc ${i + 1}`, docStatuses[i], flag, days, (i * 3)]);
      manifest.hrgaLegalIds.push(r.rows[0].id);
    }
    const letterStatuses = L.spreadStatuses(LETTER_STATUS, 12);
    for (let i = 0; i < 12; i++) {
      const r = await client.query(
        `INSERT INTO company_letters (letter_record_number, subject, letter_status, access_scope, created_at)
         VALUES ($1,$2,$3,'hrga_only', now() - ($4 || ' days')::interval) RETURNING id`,
        [fmt('LTR', i + 1), `Surat Resmi ${i + 1}`, letterStatuses[i], (i * 2)]);
      manifest.hrgaLetterIds.push(r.rows[0].id);
    }
    const reasons = L.spreadStatuses(ARCHIVE_REASON, 8);
    for (let i = 0; i < 8; i++) {
      const src = manifest.hrgaLegalIds[i % manifest.hrgaLegalIds.length];
      const r = await client.query(
        `INSERT INTO hrga_archive_records
           (archive_record_number, source_module, source_record_id, archive_reason, access_scope, created_at)
         VALUES ($1,'legalitas',$2,$3,'hrga_only', now() - ($4 || ' days')::interval) RETURNING id`,
        [fmt('ARC', i + 1), src, reasons[i], (i * 5)]);
      manifest.hrgaArchiveIds.push(r.rows[0].id);
    }
  });
}
module.exports = { seedHrga };

'use strict';

const db = require('../config/database');
const notificationService = require('../services/notification.service');

// Background job: MOD_tax_insurance §TAX BACKGROUND JOB.
//
// Schedule (per spec): first day of each month at 08:00. Safe to run daily —
// the individual reminders are idempotent because each one sets a tagged
// sla_tracking row and the job skips records that already have one for the
// current Masa Pajak.
//
// Responsibilities:
//   1. Enumerate the PREVIOUS calendar month's Masa Pajak.
//   2. For each required tax_type (PPh 21, PPh 25, PPN) that has no record
//      for that Masa Pajak → emit tax.reminder.missing_record (if template
//      exists) or a best-effort tax.reminder.unpaid fallback.
//   3. For every record with payment_status='Unpaid' whose Masa Pajak has
//      closed → emit tax.reminder.unpaid.
//   4. For every SPT-obligated record (tax_category IN 'SPT Reporting' or
//      'Combined Record') with null reporting_date and a closed Masa Pajak
//      → emit tax.reminder.spt_not_filed.
//
// Idempotency: sla_tracking is used as a dedupe ledger. Each reminder has
// entity_type of the form 'tax_operational_records.<reminder_kind>' so
// stage-scoped bookkeeping is explicit; a closed Masa Pajak that is fixed
// (e.g. Unpaid → Paid) clears its own reminder via a separate
// acknowledge path (not yet wired — see notes below).

const REMINDER_UNPAID = 'tax_operational_records.reminder_unpaid';
const REMINDER_SPT = 'tax_operational_records.reminder_spt_not_filed';
const REMINDER_MISSING = 'tax_operational_records.reminder_missing_record';

// Required tax types per MOD_tax_insurance §Widget 1 alert logic. 'Others'
// is deliberately excluded — it's a catch-all for future tax categories,
// not a mandatory monthly filing.
const REQUIRED_TAX_TYPES = Object.freeze(['PPh 21', 'PPh 25', 'PPN']);

function previousMasaPajak(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1; // 1-12
    if (month === 1) return { month: 12, year: year - 1 };
    return { month: month - 1, year };
}

async function hasReminder(client, entityType, entityId, stage) {
    const { rows } = await client.query(
        `SELECT 1 FROM sla_tracking
          WHERE entity_type = $1 AND entity_id = $2 AND stage = $3
          LIMIT 1`,
        [entityType, entityId, stage],
    );
    return rows.length > 0;
}

async function recordReminder(client, entityType, entityId, stage) {
    await client.query(
        `INSERT INTO sla_tracking
           (entity_type, entity_id, stage,
            due_at, overdue_at, escalation_sent_at)
         VALUES ($1, $2, $3, now(), now(), now())`,
        [entityType, entityId, stage],
    );
}

// ---------------------------------------------------------------------------
// RULE 1 — Missing required record for closed Masa Pajak
// ---------------------------------------------------------------------------
//
// MOD_tax_insurance §TAX BACKGROUND JOB step 2: "If any tax_type has no
// record for that month → create alert notification." The alert has no
// natural entity_id (the record doesn't exist yet); we use the deterministic
// pseudo-id `md5(month||year||tax_type)::uuid` as the sla_tracking key so
// the dedupe still works across job runs.

function synthKey(month, year, taxType) {
    // Deterministic uuid from the tuple. Done in SQL so we don't need a
    // crypto import — pg has md5() built in.
    return { month, year, tax_type: taxType };
}

async function findMissingRequired(client, masa) {
    const present = new Set();
    const { rows } = await client.query(
        `SELECT DISTINCT tax_type FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND masa_pajak_month = $1
            AND masa_pajak_year  = $2
            AND tax_type = ANY($3::text[])`,
        [masa.month, masa.year, REQUIRED_TAX_TYPES],
    );
    for (const r of rows) present.add(r.tax_type);
    return REQUIRED_TAX_TYPES.filter((t) => !present.has(t));
}

async function hasMissingReminder(client, masa, taxType) {
    const { rows } = await client.query(
        `SELECT 1 FROM sla_tracking
          WHERE entity_type = $1
            AND stage = $2
          LIMIT 1`,
        [REMINDER_MISSING, missingStage(masa, taxType)],
    );
    return rows.length > 0;
}

async function recordMissingReminder(client, masa, taxType) {
    // synth entity_id from md5(tax_type || month || year). Using a real
    // uuid column keeps sla_tracking schema-consistent; md5 gives a stable
    // 32-hex string that pg will cast to uuid.
    await client.query(
        `INSERT INTO sla_tracking
           (entity_type, entity_id, stage,
            due_at, overdue_at, escalation_sent_at)
         VALUES ($1,
                 md5($2 || '|' || $3 || '|' || $4)::uuid,
                 $5, now(), now(), now())`,
        [
            REMINDER_MISSING,
            taxType, String(masa.month), String(masa.year),
            missingStage(masa, taxType),
        ],
    );
}

function missingStage(masa, taxType) {
    return `${taxType}:${masa.year}-${String(masa.month).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// RULE 2 — Unpaid records for closed Masa Pajak
// ---------------------------------------------------------------------------

async function findUnpaidClosedMasaPajak(client, masa) {
    // "End of month + 1 day" per MOD_tax_insurance: if we're running on the
    // first of month M for Masa Pajak (M-1, Y), every record in that Masa
    // Pajak is already closed. We keep the closed-window check in SQL via
    // masa_pajak < date_trunc('month', now()) so running the job late (e.g.
    // mid-month) still picks up all historically closed months.
    const { rows } = await client.query(
        `SELECT id, tax_operational_record_number, tax_type,
                masa_pajak_month, masa_pajak_year, pic_user_id, amount, currency
           FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND payment_status = 'Unpaid'
            AND masa_pajak IS NOT NULL
            AND masa_pajak < date_trunc('month', now())
            AND record_status NOT IN ('Archived')
            AND ($1::int IS NULL OR masa_pajak_month = $1)
            AND ($2::int IS NULL OR masa_pajak_year  = $2)`,
        [masa?.month ?? null, masa?.year ?? null],
    );
    return rows;
}

// ---------------------------------------------------------------------------
// RULE 3 — SPT obligation not filed for closed Masa Pajak
// ---------------------------------------------------------------------------

async function findSptUnfiledClosedMasaPajak(client, masa) {
    const { rows } = await client.query(
        `SELECT id, tax_operational_record_number, tax_type, tax_category,
                masa_pajak_month, masa_pajak_year, pic_user_id
           FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND tax_category IN ('SPT Reporting','Combined Record')
            AND reporting_date IS NULL
            AND masa_pajak IS NOT NULL
            AND masa_pajak < date_trunc('month', now())
            AND record_status NOT IN ('Archived')
            AND ($1::int IS NULL OR masa_pajak_month = $1)
            AND ($2::int IS NULL OR masa_pajak_year  = $2)`,
        [masa?.month ?? null, masa?.year ?? null],
    );
    return rows;
}

function formatMasa(record) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ];
    if (record.masa_pajak_month && record.masa_pajak_year) {
        return `${months[record.masa_pajak_month - 1]} ${record.masa_pajak_year}`;
    }
    return '(unset Masa Pajak)';
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

/**
 * Scan tax_operational_records and fire three reminder classes.
 *
 * @param {object} [options]
 * @param {object} [options.masaPajak]  { month, year } — defaults to
 *                                      previousMasaPajak(now()). Pass null
 *                                      to scan every closed Masa Pajak.
 * @returns {Promise<{missing:number, unpaid:number, spt:number}>}
 */
async function run(options = {}) {
    return db.withTransaction(async (c) => {
        const masa = options.masaPajak === null
            ? null
            : (options.masaPajak || previousMasaPajak());

        let missingCount = 0;
        let unpaidCount = 0;
        let sptCount = 0;

        // --- Rule 1: missing required record -----------------------------
        if (masa) {
            const missing = await findMissingRequired(c, masa);
            for (const taxType of missing) {
                const already = await hasMissingReminder(c, masa, taxType);
                if (already) continue;

                await recordMissingReminder(c, masa, taxType);
                await notificationService.emit(c, {
                    templateKey: 'tax.reminder.unpaid',
                    title: `Tax record missing: ${taxType} for ${formatMasa({
                        masa_pajak_month: masa.month,
                        masa_pajak_year: masa.year,
                    })}`,
                    message: `No ${taxType} record has been created for Masa Pajak `
                        + `${formatMasa({
                            masa_pajak_month: masa.month,
                            masa_pajak_year: masa.year,
                        })}. This Masa Pajak is now closed.`,
                    module: 'tax',
                    entityType: 'tax_operational_records',
                    entityId: null,
                    extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
                });
                missingCount += 1;
            }
        }

        // --- Rule 2: unpaid closed Masa Pajak -----------------------------
        const unpaidRows = await findUnpaidClosedMasaPajak(c, masa);
        for (const row of unpaidRows) {
            if (await hasReminder(c, REMINDER_UNPAID, row.id, 'unpaid')) continue;
            await recordReminder(c, REMINDER_UNPAID, row.id, 'unpaid');

            await notificationService.emit(c, {
                templateKey: 'tax.reminder.unpaid',
                title: `Tax payment overdue: ${row.tax_operational_record_number}`,
                message: `${row.tax_type} for ${formatMasa(row)} is still Unpaid. `
                    + `${row.currency || 'IDR'} ${row.amount ?? '(amount unset)'}.`,
                module: 'tax',
                entityType: 'tax_operational_records',
                entityId: row.id,
                extraRecipientUserIds: row.pic_user_id ? [row.pic_user_id] : [],
                extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
            });
            unpaidCount += 1;
        }

        // --- Rule 3: SPT not filed ----------------------------------------
        const sptRows = await findSptUnfiledClosedMasaPajak(c, masa);
        for (const row of sptRows) {
            if (await hasReminder(c, REMINDER_SPT, row.id, 'spt_not_filed')) continue;
            await recordReminder(c, REMINDER_SPT, row.id, 'spt_not_filed');

            await notificationService.emit(c, {
                templateKey: 'tax.reminder.spt_not_filed',
                title: `SPT not filed: ${row.tax_operational_record_number}`,
                message: `${row.tax_type} SPT for ${formatMasa(row)} has not been filed `
                    + '(reporting_date is null).',
                module: 'tax',
                entityType: 'tax_operational_records',
                entityId: row.id,
                extraRecipientUserIds: row.pic_user_id ? [row.pic_user_id] : [],
                extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
            });
            sptCount += 1;
        }

        return { missing: missingCount, unpaid: unpaidCount, spt: sptCount };
    });
}

module.exports = {
    run,
    previousMasaPajak,
    REQUIRED_TAX_TYPES,
    REMINDER_UNPAID,
    REMINDER_SPT,
    REMINDER_MISSING,
};

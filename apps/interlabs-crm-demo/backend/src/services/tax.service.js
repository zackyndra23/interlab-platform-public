'use strict';

const db = require('../config/database');
const notificationService = require('./notification.service');
const { nextRecordNumber, TAX_PREFIXES } = require('../utils/recordNumbers');
const { parsePagination, buildMeta } = require('../utils/pagination');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// Tax & Insurance service layer.
//
// Owns tax_operational_records (primary) and tax_operational_audit_log
// (immutable mutation log). MOD_tax_insurance.txt §Audit Trail Requirements
// mandates a log row for every create / update / status change / archive.
//
// Notification events (MOD_tax_insurance §NOTIFICATION EVENTS):
//   tax.record.created     — new record inserted
//   tax.record.submitted   — record_status → Submitted
//   tax.record.paid        — payment_status → Paid (+ payment_date + file)
//   tax.record.verified    — record_status → Verified
//   tax.reminder.unpaid          — emitted by taxDeadlineMonitor job
//   tax.reminder.spt_not_filed   — emitted by taxDeadlineMonitor job
//
// Conditional field logic (tax_category gating of SPT/SSP fields) is
// primarily enforced by Joi (validators/tax.validators.js). This service
// re-applies the gate when `tax_category` is omitted from an update body
// so a caller cannot sneak SPT fields into an SSP-only record.

// ---------------------------------------------------------------------------
// FIELD GROUPS — used by the conditional-update gate and by the
// tax_deadline_monitor job's "SPT filing missing" rule.
// ---------------------------------------------------------------------------

const SPT_ONLY_FIELDS = Object.freeze([
    'jenis_spt', 'status_spt', 'reporting_date', 'attachment_spt_file_ids',
]);

const SSP_ONLY_FIELDS = Object.freeze([
    'billing_code', 'ntpn', 'ntb', 'stan', 'bank_name',
    'payment_date', 'amount', 'currency',
    'attachment_ssp_file_ids', 'attachment_payment_file_ids',
]);

// Fields persisted directly on tax_operational_records. Drives the audit
// diff helper — keys outside this set (attachment_*_file_ids) live in
// file_attachments and are diffed by count, not value.
const PERSISTED_FIELDS = Object.freeze([
    'tax_type', 'tax_category',
    'masa_pajak', 'masa_pajak_month', 'masa_pajak_year', 'tahun_pajak',
    'npwp', 'taxpayer_name', 'taxpayer_address',
    'jenis_spt', 'status_spt', 'reporting_date',
    'billing_code', 'ntpn', 'ntb', 'stan', 'bank_name',
    'payment_date', 'amount', 'currency',
    'payment_status', 'record_status',
    'pic_user_id', 'notes',
]);

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

async function attachFilesToEntity(client, attachmentIds, relatedModule, entityId) {
    if (!attachmentIds || attachmentIds.length === 0) return 0;
    const { rowCount } = await client.query(
        `UPDATE file_attachments
            SET related_module    = $1,
                related_entity_id = $2
          WHERE id = ANY($3::uuid[])
            AND deleted_at IS NULL`,
        [relatedModule, entityId, attachmentIds],
    );
    if (rowCount !== attachmentIds.length) {
        throw new BadRequestError(
            `Expected ${attachmentIds.length} attachments to bind; only ${rowCount} matched`,
        );
    }
    return rowCount;
}

async function requireRow(id, runner = db) {
    const { rows } = await runner.query(
        `SELECT * FROM tax_operational_records
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
    );
    if (rows.length === 0) {
        throw new NotFoundError(`tax_operational_records ${id} not found`);
    }
    return rows[0];
}

// masa_pajak is canonically the first day of the reporting month. Accept
// either a full date (taken as-is, floored to first-of-month) or explicit
// month+year and derive the other fields. Always persists all three
// (masa_pajak, masa_pajak_month, masa_pajak_year) so the dashboard
// aggregate queries stay simple.
function normalizeMasaPajak(input) {
    if (input.masa_pajak) {
        const d = input.masa_pajak instanceof Date
            ? input.masa_pajak
            : new Date(input.masa_pajak);
        if (Number.isNaN(d.getTime())) {
            throw new BadRequestError('masa_pajak is not a valid date');
        }
        const month = d.getUTCMonth() + 1;
        const year = d.getUTCFullYear();
        const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
        return {
            masa_pajak: firstOfMonth.toISOString().slice(0, 10),
            masa_pajak_month: month,
            masa_pajak_year: year,
        };
    }
    if (input.masa_pajak_month && input.masa_pajak_year) {
        const firstOfMonth = new Date(Date.UTC(
            input.masa_pajak_year, input.masa_pajak_month - 1, 1,
        ));
        return {
            masa_pajak: firstOfMonth.toISOString().slice(0, 10),
            masa_pajak_month: input.masa_pajak_month,
            masa_pajak_year: input.masa_pajak_year,
        };
    }
    return {
        masa_pajak: null,
        masa_pajak_month: input.masa_pajak_month ?? null,
        masa_pajak_year: input.masa_pajak_year ?? null,
    };
}

function enforceCategoryGate(tax_category, body) {
    if (tax_category === 'SSP Payment') {
        for (const f of SPT_ONLY_FIELDS) {
            if (body[f] !== undefined) {
                throw new BadRequestError(
                    `Field '${f}' not allowed on tax_category='SSP Payment'`,
                );
            }
        }
    } else if (tax_category === 'SPT Reporting') {
        for (const f of SSP_ONLY_FIELDS) {
            if (body[f] !== undefined) {
                throw new BadRequestError(
                    `Field '${f}' not allowed on tax_category='SPT Reporting'`,
                );
            }
        }
    }
}

function computeDiff(before, after) {
    const diff = {};
    for (const key of PERSISTED_FIELDS) {
        const b = before ? before[key] : undefined;
        const a = after ? after[key] : undefined;
        // Compare by string form so Date vs ISO and numeric vs string don't
        // generate spurious diffs. nulls stay distinct from ''.
        const bNorm = b instanceof Date ? b.toISOString() : b;
        const aNorm = a instanceof Date ? a.toISOString() : a;
        if (bNorm !== aNorm) {
            diff[key] = { old: b ?? null, new: a ?? null };
        }
    }
    return diff;
}

async function writeAuditLog(client, {
    recordId, action, changedFields = {}, actor,
}) {
    await client.query(
        `INSERT INTO tax_operational_audit_log
           (record_id, action, changed_fields, actor_user_id, actor_role)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [
            recordId, action, JSON.stringify(changedFields),
            actor ? actor.id : null,
            actor ? actor.role : null,
        ],
    );
}

async function bindAllAttachments(client, data, recordId) {
    const groups = [
        ['attachment_ssp_file_ids', 'tax.ssp'],
        ['attachment_spt_file_ids', 'tax.spt'],
        ['attachment_payment_file_ids', 'tax.payment'],
        ['attachment_supporting_file_ids', 'tax.supporting'],
    ];
    for (const [key, relatedModule] of groups) {
        const ids = data[key];
        if (Array.isArray(ids) && ids.length > 0) {
            await attachFilesToEntity(client, ids, relatedModule, recordId);
        }
    }
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

async function listRecords({ query, scopeUserId }) {
    const { page, limit, offset } = parsePagination(query);
    const clauses = ['deleted_at IS NULL'];
    const params = [];

    // keyword search hits npwp / taxpayer_name / billing_code / ntpn / ntb /
    // notes — MOD_tax_insurance §TAX OPERATIONAL TABLE VIEW §Filters.
    if (query.search) {
        params.push(`%${query.search}%`);
        const p = `$${params.length}`;
        clauses.push(
            `(npwp ILIKE ${p} OR taxpayer_name ILIKE ${p} OR billing_code ILIKE ${p} `
            + `OR ntpn ILIKE ${p} OR ntb ILIKE ${p} OR notes ILIKE ${p})`,
        );
    }
    if (scopeUserId) {
        params.push(scopeUserId);
        clauses.push(`created_by = $${params.length}`);
    }

    const push = (sql, value) => {
        params.push(value);
        clauses.push(sql.replace('$X', `$${params.length}`));
    };
    if (query.tax_type) push('tax_type = $X', query.tax_type);
    if (query.tax_category) push('tax_category = $X', query.tax_category);
    if (query.record_status) push('record_status = $X', query.record_status);
    if (query.payment_status) push('payment_status = $X', query.payment_status);
    if (query.pic_user_id) push('pic_user_id = $X', query.pic_user_id);
    if (query.npwp) push('npwp ILIKE $X', `%${query.npwp}%`);
    if (query.masa_pajak_month) push('masa_pajak_month = $X', query.masa_pajak_month);
    if (query.masa_pajak_year) push('masa_pajak_year = $X', query.masa_pajak_year);
    if (query.tahun_pajak) push('tahun_pajak = $X', query.tahun_pajak);
    if (query.masa_pajak_from) push('masa_pajak >= $X', query.masa_pajak_from);
    if (query.masa_pajak_to) push('masa_pajak <= $X', query.masa_pajak_to);

    const where = clauses.join(' AND ');
    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM tax_operational_records WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT * FROM tax_operational_records
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function getRecord(id) {
    return requireRow(id);
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

async function createRecord(data, actor) {
    enforceCategoryGate(data.tax_category, data);

    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'tax_operational_records', 'tax_operational_record_number',
            TAX_PREFIXES.OPERATIONAL,
        );
        const masa = normalizeMasaPajak(data);

        const { rows } = await c.query(
            `INSERT INTO tax_operational_records
               (tax_operational_record_number,
                tax_type, tax_category,
                masa_pajak, masa_pajak_month, masa_pajak_year, tahun_pajak,
                npwp, taxpayer_name, taxpayer_address,
                jenis_spt, status_spt, reporting_date,
                billing_code, ntpn, ntb, stan, bank_name,
                payment_date, amount, currency,
                payment_status, record_status,
                pic_user_id, notes,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                     COALESCE($21,'IDR'),
                     COALESCE($22,'Unpaid'),
                     COALESCE($23,'Draft'),
                     $24,$25,$26,$26)
             RETURNING *`,
            [
                recordNumber,
                data.tax_type, data.tax_category,
                masa.masa_pajak, masa.masa_pajak_month, masa.masa_pajak_year,
                data.tahun_pajak ?? masa.masa_pajak_year ?? null,
                data.npwp, data.taxpayer_name, data.taxpayer_address,
                data.jenis_spt, data.status_spt, data.reporting_date,
                data.billing_code, data.ntpn, data.ntb, data.stan, data.bank_name,
                data.payment_date, data.amount, data.currency,
                data.payment_status, data.record_status,
                data.pic_user_id, data.notes,
                actor.id,
            ],
        );
        const record = rows[0];

        await bindAllAttachments(c, data, record.id);

        await writeAuditLog(c, {
            recordId: record.id,
            action: 'created',
            changedFields: { snapshot: snapshotForAudit(record) },
            actor,
        });

        // tax.record.created — recipients per MOD_tax_insurance §NOTIFICATION EVENTS.
        await notificationService.emit(c, {
            templateKey: 'tax.record.created',
            title: `Tax record ${record.tax_operational_record_number} created`,
            message: `${record.tax_type} / ${record.tax_category} for `
                + `${formatMasa(record)} — NPWP ${record.npwp}.`,
            module: 'tax',
            entityType: 'tax_operational_records',
            entityId: record.id,
            senderUserId: actor.id,
            extraRecipientUserIds: record.pic_user_id ? [record.pic_user_id] : [],
            extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
        });

        return record;
    });
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

async function updateRecord(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM tax_operational_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`tax_operational_records ${id} not found`);
        }
        const before = lockRows[0];

        if (before.record_status === 'Archived') {
            throw new ConflictError(
                `Record ${before.tax_operational_record_number} is Archived; cannot edit`,
            );
        }

        // Re-apply the conditional gate against the effective category so
        // clients can't sneak disallowed fields in by omitting tax_category.
        const effectiveCategory = data.tax_category ?? before.tax_category;
        enforceCategoryGate(effectiveCategory, data);

        const masaChanging = data.masa_pajak !== undefined
            || data.masa_pajak_month !== undefined
            || data.masa_pajak_year !== undefined;
        const masa = masaChanging
            ? normalizeMasaPajak({
                masa_pajak: data.masa_pajak,
                masa_pajak_month: data.masa_pajak_month ?? before.masa_pajak_month,
                masa_pajak_year: data.masa_pajak_year ?? before.masa_pajak_year,
            })
            : null;

        const { rows } = await c.query(
            `UPDATE tax_operational_records SET
                tax_type         = COALESCE($2, tax_type),
                tax_category     = COALESCE($3, tax_category),
                masa_pajak       = CASE WHEN $4::boolean THEN $5 ELSE masa_pajak END,
                masa_pajak_month = CASE WHEN $4::boolean THEN $6 ELSE masa_pajak_month END,
                masa_pajak_year  = CASE WHEN $4::boolean THEN $7 ELSE masa_pajak_year END,
                tahun_pajak      = COALESCE($8, tahun_pajak),
                npwp             = COALESCE($9, npwp),
                taxpayer_name    = COALESCE($10, taxpayer_name),
                taxpayer_address = COALESCE($11, taxpayer_address),
                jenis_spt        = COALESCE($12, jenis_spt),
                status_spt       = COALESCE($13, status_spt),
                reporting_date   = COALESCE($14, reporting_date),
                billing_code     = COALESCE($15, billing_code),
                ntpn             = COALESCE($16, ntpn),
                ntb              = COALESCE($17, ntb),
                stan             = COALESCE($18, stan),
                bank_name        = COALESCE($19, bank_name),
                payment_date     = COALESCE($20, payment_date),
                amount           = COALESCE($21, amount),
                currency         = COALESCE($22, currency),
                payment_status   = COALESCE($23, payment_status),
                record_status    = COALESCE($24, record_status),
                pic_user_id      = COALESCE($25, pic_user_id),
                notes            = COALESCE($26, notes),
                updated_by       = $27,
                updated_at       = now()
              WHERE id = $1
              RETURNING *`,
            [
                id,
                data.tax_type, data.tax_category,
                masaChanging, masa?.masa_pajak, masa?.masa_pajak_month, masa?.masa_pajak_year,
                data.tahun_pajak,
                data.npwp, data.taxpayer_name, data.taxpayer_address,
                data.jenis_spt, data.status_spt, data.reporting_date,
                data.billing_code, data.ntpn, data.ntb, data.stan, data.bank_name,
                data.payment_date, data.amount, data.currency,
                data.payment_status, data.record_status,
                data.pic_user_id, data.notes,
                actor.id,
            ],
        );
        const after = rows[0];

        await bindAllAttachments(c, data, after.id);

        const diff = computeDiff(before, after);
        const statusChanged = diff.record_status || diff.payment_status;
        const hasFieldDiff = Object.keys(diff).length > 0;

        if (hasFieldDiff) {
            await writeAuditLog(c, {
                recordId: after.id,
                action: statusChanged ? 'status_changed' : 'updated',
                changedFields: diff,
                actor,
            });
        }

        // Emit lifecycle notifications when the status or payment state
        // actually changed. Each event is guarded by a before/after check so
        // no-op saves don't spam subscribers.
        await emitLifecycleNotifications(c, before, after, actor);

        return after;
    });
}

// Dedicated status-transition endpoint. Same behaviour as updateRecord but
// only accepts record_status / payment_status / payment_date / reporting_date
// and always logs action='status_changed'.
async function changeStatus(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM tax_operational_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`tax_operational_records ${id} not found`);
        }
        const before = lockRows[0];
        if (before.record_status === 'Archived') {
            throw new ConflictError(
                `Record ${before.tax_operational_record_number} is Archived; cannot transition`,
            );
        }

        const { rows } = await c.query(
            `UPDATE tax_operational_records SET
                record_status  = COALESCE($2, record_status),
                payment_status = COALESCE($3, payment_status),
                payment_date   = COALESCE($4, payment_date),
                reporting_date = COALESCE($5, reporting_date),
                notes          = COALESCE($6, notes),
                updated_by     = $7,
                updated_at     = now()
              WHERE id = $1
              RETURNING *`,
            [
                id, input.record_status, input.payment_status,
                input.payment_date, input.reporting_date,
                input.note, actor.id,
            ],
        );
        const after = rows[0];

        const diff = computeDiff(before, after);
        if (Object.keys(diff).length > 0) {
            await writeAuditLog(c, {
                recordId: after.id,
                action: after.record_status === 'Archived' ? 'archived' : 'status_changed',
                changedFields: diff,
                actor,
            });
        }

        await emitLifecycleNotifications(c, before, after, actor);
        return after;
    });
}

async function emitLifecycleNotifications(client, before, after, actor) {
    if (!after) return;

    // tax.record.submitted
    if (before.record_status !== 'Submitted' && after.record_status === 'Submitted') {
        await notificationService.emit(client, {
            templateKey: 'tax.record.submitted',
            title: `Tax record ${after.tax_operational_record_number} submitted`,
            message: `${after.tax_type} / ${after.tax_category} for ${formatMasa(after)}.`,
            module: 'tax',
            entityType: 'tax_operational_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRecipientUserIds: after.pic_user_id ? [after.pic_user_id] : [],
            extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
        });
    }

    // tax.record.verified
    if (before.record_status !== 'Verified' && after.record_status === 'Verified') {
        await notificationService.emit(client, {
            templateKey: 'tax.record.verified',
            title: `Tax record ${after.tax_operational_record_number} verified`,
            message: `${after.tax_type} / ${after.tax_category} for ${formatMasa(after)}.`,
            module: 'tax',
            entityType: 'tax_operational_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRecipientUserIds: after.pic_user_id ? [after.pic_user_id] : [],
            extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
        });
    }

    // tax.record.paid — only when payment_status transitions to Paid AND
    // payment_date is populated (MOD_tax_insurance: "payment_date +
    // attachment entered"). Attachment presence is treated as best-effort:
    // we don't fail the status change if SSP files are missing, but the
    // notification waits until a payment_date exists.
    const becamePaid = before.payment_status !== 'Paid' && after.payment_status === 'Paid';
    if (becamePaid && after.payment_date) {
        await notificationService.emit(client, {
            templateKey: 'tax.record.paid',
            title: `Tax record ${after.tax_operational_record_number} paid`,
            message: `${after.tax_type} ${formatMasa(after)} — `
                + `${after.currency || 'IDR'} ${after.amount ?? ''} paid on `
                + `${toISODate(after.payment_date)}.`,
            module: 'tax',
            entityType: 'tax_operational_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRecipientUserIds: after.pic_user_id ? [after.pic_user_id] : [],
            extraRoles: ['tax_insurance', 'superadmin', 'ceo'],
        });
    }
}

// ---------------------------------------------------------------------------
// DELETE (soft)
// ---------------------------------------------------------------------------

async function deleteRecord(id, actor) {
    return db.withTransaction(async (c) => {
        const existing = await requireRow(id, c);
        if (existing.record_status === 'Verified'
            || existing.record_status === 'Archived') {
            throw new ConflictError(
                `Cannot soft-delete record ${existing.tax_operational_record_number} in status ${existing.record_status}`,
            );
        }
        await c.query(
            `UPDATE tax_operational_records
                SET deleted_at = now(), updated_by = $2, updated_at = now()
              WHERE id = $1`,
            [id, actor.id],
        );
        await writeAuditLog(c, {
            recordId: id,
            action: 'archived',
            changedFields: { deleted_at: { old: null, new: 'now()' } },
            actor,
        });
    });
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------

async function listAuditLog(recordId, { query }) {
    await requireRow(recordId);
    const { page, limit, offset } = parsePagination(query);
    const clauses = ['record_id = $1'];
    const params = [recordId];

    if (query.action) {
        params.push(query.action);
        clauses.push(`action = $${params.length}`);
    }
    if (query.actor_user_id) {
        params.push(query.actor_user_id);
        clauses.push(`actor_user_id = $${params.length}`);
    }
    if (query.from) {
        params.push(query.from);
        clauses.push(`created_at >= $${params.length}`);
    }
    if (query.to) {
        params.push(query.to);
        clauses.push(`created_at <= $${params.length}`);
    }
    const where = clauses.join(' AND ');

    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM tax_operational_audit_log WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT * FROM tax_operational_audit_log
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

// Masa Pajak Status Board — current month breakdown per tax_type, plus
// counts of Unpaid / Draft records. Also flags any required tax type that
// has zero records for the current month, driving the dashboard "missing
// record" alert.
async function dashboardCurrentMasaPajak() {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const { rows: typeRows } = await db.query(
        `SELECT tax_type, count(*)::int AS total,
                count(*) FILTER (WHERE payment_status = 'Unpaid')::int AS unpaid,
                count(*) FILTER (WHERE record_status = 'Draft')::int AS draft
           FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND masa_pajak_month = $1 AND masa_pajak_year = $2
          GROUP BY tax_type`,
        [month, year],
    );

    const typeMap = new Map(typeRows.map((r) => [r.tax_type, r]));
    const required = ['PPh 21', 'PPh 25', 'PPN'];
    const missing = required.filter((t) => !typeMap.has(t));

    return {
        masa_pajak_month: month,
        masa_pajak_year: year,
        by_tax_type: typeRows,
        missing_required_tax_types: missing,
    };
}

async function dashboardMonthlySummary(taxType, months = 12) {
    const { rows } = await db.query(
        `SELECT masa_pajak_year AS year,
                masa_pajak_month AS month,
                count(*)::int AS record_count,
                coalesce(sum(amount), 0) AS total_amount
           FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND tax_type = $1
            AND masa_pajak IS NOT NULL
            AND masa_pajak >= (date_trunc('month', now()) - ($2 || ' months')::interval)
          GROUP BY masa_pajak_year, masa_pajak_month
          ORDER BY masa_pajak_year ASC, masa_pajak_month ASC`,
        [taxType, String(months - 1)],
    );
    return rows;
}

// PPN Periodic Summary — per-period payment total AND SPT filing state.
// SPT is considered "filed" when the record's reporting_date is non-null
// for at least one Combined or SPT Reporting row in the period.
async function dashboardPpnSummary(months = 12) {
    const { rows } = await db.query(
        `SELECT masa_pajak_year AS year,
                masa_pajak_month AS month,
                coalesce(sum(amount) FILTER (WHERE tax_category IN ('SSP Payment','Combined Record')), 0) AS total_paid,
                bool_or(reporting_date IS NOT NULL
                        AND tax_category IN ('SPT Reporting','Combined Record')) AS spt_filed
           FROM tax_operational_records
          WHERE deleted_at IS NULL
            AND tax_type = 'PPN'
            AND masa_pajak IS NOT NULL
            AND masa_pajak >= (date_trunc('month', now()) - ($1 || ' months')::interval)
          GROUP BY masa_pajak_year, masa_pajak_month
          ORDER BY masa_pajak_year ASC, masa_pajak_month ASC`,
        [String(months - 1)],
    );
    return rows;
}

async function dashboardRecentActivity(limit = 5) {
    const { rows } = await db.query(
        `SELECT al.id, al.action, al.actor_user_id, al.actor_role, al.created_at,
                r.tax_operational_record_number, r.tax_type, r.tax_category,
                r.record_status, r.payment_status
           FROM tax_operational_audit_log al
           JOIN tax_operational_records r ON r.id = al.record_id
          WHERE r.deleted_at IS NULL
          ORDER BY al.created_at DESC
          LIMIT $1`,
        [limit],
    );
    return rows;
}

// Pending Actions widget — MOD_tax_insurance §Widget 6.
async function dashboardPendingActions() {
    const [draftsOver7d, unpaidPastDate, sptMissing] = await Promise.all([
        db.query(
            `SELECT id, tax_operational_record_number, tax_type, created_at
               FROM tax_operational_records
              WHERE deleted_at IS NULL
                AND record_status = 'Draft'
                AND created_at < now() - INTERVAL '7 days'
              ORDER BY created_at ASC
              LIMIT 50`,
        ),
        db.query(
            `SELECT id, tax_operational_record_number, tax_type, payment_date
               FROM tax_operational_records
              WHERE deleted_at IS NULL
                AND payment_status = 'Unpaid'
                AND payment_date IS NOT NULL
                AND payment_date < CURRENT_DATE
              ORDER BY payment_date ASC
              LIMIT 50`,
        ),
        db.query(
            `SELECT id, tax_operational_record_number, tax_type,
                    masa_pajak_month, masa_pajak_year
               FROM tax_operational_records
              WHERE deleted_at IS NULL
                AND tax_category IN ('SPT Reporting','Combined Record')
                AND reporting_date IS NULL
                AND masa_pajak IS NOT NULL
                AND masa_pajak < date_trunc('month', now())
              ORDER BY masa_pajak ASC
              LIMIT 50`,
        ),
    ]);
    return {
        drafts_over_7d: draftsOver7d.rows,
        unpaid_past_payment_date: unpaidPastDate.rows,
        spt_missing_for_closed_masa_pajak: sptMissing.rows,
    };
}

// ---------------------------------------------------------------------------
// INTERNAL UTILITIES
// ---------------------------------------------------------------------------

function formatMasa(record) {
    if (!record) return '';
    if (record.masa_pajak_month && record.masa_pajak_year) {
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ];
        return `${months[record.masa_pajak_month - 1]} ${record.masa_pajak_year}`;
    }
    return record.tahun_pajak ? String(record.tahun_pajak) : '';
}

function toISODate(d) {
    if (!d) return '';
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

// Snapshot used in tax.record.created audit entry. Keeps the audit log
// self-contained without forcing consumers to join back to the current
// row (which may have been updated since).
function snapshotForAudit(record) {
    const snap = {};
    for (const f of PERSISTED_FIELDS) {
        snap[f] = record[f] ?? null;
    }
    return snap;
}

module.exports = {
    // CRUD
    listRecords, getRecord, createRecord, updateRecord, changeStatus, deleteRecord,

    // Audit
    listAuditLog,

    // Dashboard
    dashboardCurrentMasaPajak, dashboardMonthlySummary, dashboardPpnSummary,
    dashboardRecentActivity, dashboardPendingActions,

    // Internal — exposed for the tax_deadline_monitor job + tests
    SPT_ONLY_FIELDS, SSP_ONLY_FIELDS, PERSISTED_FIELDS,
    normalizeMasaPajak, computeDiff, writeAuditLog,
    emitLifecycleNotifications,
};

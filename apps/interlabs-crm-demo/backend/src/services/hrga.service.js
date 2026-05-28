'use strict';

const db = require('../config/database');
const notificationService = require('./notification.service');
const { nextRecordNumber, HRGA_PREFIXES } = require('../utils/recordNumbers');
const { parsePagination, buildMeta } = require('../utils/pagination');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// HRGA / Legal service layer.
//
// Sub-modules (MOD_hrga.txt):
//   - Legalitas (hrga_legal_documents)  — structured legal/compliance repo,
//     versioning via supersede, expiry-flag bookkeeping.
//   - Company Letters (company_letters) — Draft → Under Review → Final →
//     Sent → Archived state machine.
//   - Letter Templates (letter_templates) — reusable HTML bodies.
//   - Archive & Repository (hrga_archive_records) — mirror store for
//     Superseded/Expired/Withdrawn documents.
//   - Smart Search — unified search over the three document stores with
//     role-gated access_scope filtering.
//   - Compliance & Expiry — list helper + background monitor (see
//     jobs/slaHrgaExpiry.job.js) that drives 90d/30d/expired notifications.
//
// Notification events emitted directly from this service:
//   hrga.letter.review_requested  — letter → Under Review
//   hrga.letter.finalized         — letter → Final
// (hrga.document.expiring_90/30/expired are emitted by the background
//  expiry monitor job, not from request handlers.)

// ---------------------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------------------

async function listRows({
    table,
    selectColumns = '*',
    search,
    searchColumn,
    scopeUserId,
    extraFilters = [],
    orderBy = 'created_at DESC',
    query,
}) {
    const { page, limit, offset } = parsePagination(query);
    const clauses = ['deleted_at IS NULL'];
    const params = [];

    if (search && searchColumn) {
        params.push(`%${search}%`);
        clauses.push(`${searchColumn} ILIKE $${params.length}`);
    }
    if (scopeUserId) {
        params.push(scopeUserId);
        clauses.push(`created_by = $${params.length}`);
    }
    for (const filter of extraFilters) {
        params.push(filter.value);
        clauses.push(filter.sql.replace('$X', `$${params.length}`));
    }

    const where = clauses.join(' AND ');
    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT ${selectColumns}
           FROM ${table}
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function requireRow(table, id, runner = db) {
    const { rows } = await runner.query(
        `SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
        [id],
    );
    if (rows.length === 0) throw new NotFoundError(`${table} row ${id} not found`);
    return rows[0];
}

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

// Compute reminder_90/30_days_at timestamps from expiry_date. Returned as
// ISO strings; pg casts them to timestamptz on insert/update.
function computeExpiryReminders(expiryDate) {
    if (!expiryDate) {
        return { reminder90: null, reminder30: null };
    }
    const exp = new Date(expiryDate);
    const reminder90 = new Date(exp.getTime());
    reminder90.setUTCDate(reminder90.getUTCDate() - 90);
    const reminder30 = new Date(exp.getTime());
    reminder30.setUTCDate(reminder30.getUTCDate() - 30);
    return {
        reminder90: reminder90.toISOString(),
        reminder30: reminder30.toISOString(),
    };
}

// ============================================================================
// LEGALITAS (hrga_legal_documents)
// ============================================================================

async function listLegalDocuments({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.document_category) {
        extraFilters.push({ sql: 'document_category = $X', value: query.document_category });
    }
    if (query.document_subcategory) {
        extraFilters.push({ sql: 'document_subcategory = $X', value: query.document_subcategory });
    }
    if (query.document_status) {
        extraFilters.push({ sql: 'document_status = $X', value: query.document_status });
    }
    if (query.compliance_flag) {
        extraFilters.push({ sql: 'compliance_flag = $X', value: query.compliance_flag });
    }
    if (query.pic_user_id) {
        extraFilters.push({ sql: 'pic_user_id = $X', value: query.pic_user_id });
    }
    if (query.related_customer_id) {
        extraFilters.push({ sql: 'related_customer_id = $X', value: query.related_customer_id });
    }
    if (query.year) {
        extraFilters.push({ sql: 'document_year = $X', value: query.year });
    }
    if (query.tag) {
        extraFilters.push({ sql: '$X::text = ANY(tags)', value: query.tag });
    }
    return listRows({
        table: 'hrga_legal_documents',
        search: query.search,
        searchColumn: 'document_name',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getLegalDocument(id) {
    return requireRow('hrga_legal_documents', id);
}

async function createLegalDocument(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'hrga_legal_documents', 'legal_document_record_number',
            HRGA_PREFIXES.LEGAL_DOCUMENT,
        );
        const { reminder90, reminder30 } = computeExpiryReminders(data.expiry_date);

        const { rows } = await c.query(
            `INSERT INTO hrga_legal_documents
               (legal_document_record_number, document_category, document_subcategory,
                document_name, document_number, document_year,
                issue_date, expiry_date,
                validity_period_start, validity_period_end,
                notary_name, related_customer_id, related_principal,
                pic_user_id, version_number, document_status,
                tags, notes, access_scope,
                reminder_90_days_at, reminder_30_days_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     $11,$12,$13,$14,$15, COALESCE($16,'Draft'),
                     COALESCE($17, ARRAY[]::text[]),$18, COALESCE($19,'hrga_only'),
                     $20,$21,$22,$22)
             RETURNING *`,
            [
                recordNumber, data.document_category, data.document_subcategory,
                data.document_name, data.document_number, data.document_year,
                data.issue_date, data.expiry_date,
                data.validity_period_start, data.validity_period_end,
                data.notary_name, data.related_customer_id, data.related_principal,
                data.pic_user_id, data.version_number, data.document_status,
                data.tags, data.notes, data.access_scope,
                reminder90, reminder30, actor.id,
            ],
        );
        const doc = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'hrga.legal_documents', doc.id,
            );
        }
        return doc;
    });
}

async function updateLegalDocument(id, data, actor) {
    return db.withTransaction(async (c) => {
        const existing = await requireRow('hrga_legal_documents', id, c);
        if (existing.document_status === 'Superseded'
            || existing.document_status === 'Archived') {
            throw new ConflictError(
                `Legal document ${existing.legal_document_record_number} is `
                + `${existing.document_status}; create a new version instead`,
            );
        }

        // Recompute reminder anchors if expiry_date is being changed.
        let reminder90 = null;
        let reminder30 = null;
        const expiryChanging = data.expiry_date !== undefined;
        if (expiryChanging) {
            const anchors = computeExpiryReminders(data.expiry_date);
            reminder90 = anchors.reminder90;
            reminder30 = anchors.reminder30;
        }

        const { rows } = await c.query(
            `UPDATE hrga_legal_documents SET
                document_category        = COALESCE($2, document_category),
                document_subcategory     = COALESCE($3, document_subcategory),
                document_name            = COALESCE($4, document_name),
                document_number          = COALESCE($5, document_number),
                document_year            = COALESCE($6, document_year),
                issue_date               = COALESCE($7, issue_date),
                expiry_date              = CASE WHEN $22::boolean THEN $8 ELSE expiry_date END,
                validity_period_start    = COALESCE($9, validity_period_start),
                validity_period_end      = COALESCE($10, validity_period_end),
                notary_name              = COALESCE($11, notary_name),
                related_customer_id      = COALESCE($12, related_customer_id),
                related_principal        = COALESCE($13, related_principal),
                pic_user_id              = COALESCE($14, pic_user_id),
                version_number           = COALESCE($15, version_number),
                document_status          = COALESCE($16, document_status),
                tags                     = COALESCE($17::text[], tags),
                notes                    = COALESCE($18, notes),
                access_scope             = COALESCE($19, access_scope),
                reminder_90_days_at      = CASE WHEN $22::boolean THEN $20 ELSE reminder_90_days_at END,
                reminder_30_days_at      = CASE WHEN $22::boolean THEN $21 ELSE reminder_30_days_at END,
                compliance_flag          = CASE WHEN $22::boolean THEN 'ok' ELSE compliance_flag END,
                expired_at               = CASE WHEN $22::boolean THEN NULL ELSE expired_at END,
                updated_by               = $23,
                updated_at               = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id,
                data.document_category, data.document_subcategory,
                data.document_name, data.document_number, data.document_year,
                data.issue_date, data.expiry_date,
                data.validity_period_start, data.validity_period_end,
                data.notary_name, data.related_customer_id, data.related_principal,
                data.pic_user_id, data.version_number, data.document_status,
                data.tags || null, data.notes, data.access_scope,
                reminder90, reminder30, expiryChanging,
                actor.id,
            ],
        );

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'hrga.legal_documents', id,
            );
        }
        return rows[0];
    });
}

/**
 * Create a new Active version of an existing legal document. The current
 * row is flipped to Superseded and its superseded_by_id is set to the new
 * record id. Both operations share a transaction so we never end up with
 * two Active rows for the same conceptual document.
 */
async function supersedeLegalDocument(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM hrga_legal_documents
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`hrga_legal_documents ${id} not found`);
        }
        const previous = lockRows[0];
        if (previous.document_status === 'Superseded'
            || previous.document_status === 'Archived') {
            throw new ConflictError(
                `Document ${previous.legal_document_record_number} cannot be superseded (status=${previous.document_status})`,
            );
        }

        const recordNumber = await nextRecordNumber(
            c, 'hrga_legal_documents', 'legal_document_record_number',
            HRGA_PREFIXES.LEGAL_DOCUMENT,
        );
        const expiryDate = data.expiry_date !== undefined
            ? data.expiry_date
            : previous.expiry_date;
        const { reminder90, reminder30 } = computeExpiryReminders(expiryDate);

        // New row copies previous values for any field the caller did not
        // provide, so a minimal supersede payload (e.g. only a new
        // version_number + attachment_ids) still produces a complete row.
        const next = {
            document_category: data.document_category ?? previous.document_category,
            document_subcategory: data.document_subcategory ?? previous.document_subcategory,
            document_name: data.document_name ?? previous.document_name,
            document_number: data.document_number ?? previous.document_number,
            document_year: data.document_year ?? previous.document_year,
            issue_date: data.issue_date ?? previous.issue_date,
            expiry_date: expiryDate,
            validity_period_start: data.validity_period_start ?? previous.validity_period_start,
            validity_period_end: data.validity_period_end ?? previous.validity_period_end,
            notary_name: data.notary_name ?? previous.notary_name,
            related_customer_id: data.related_customer_id ?? previous.related_customer_id,
            related_principal: data.related_principal ?? previous.related_principal,
            pic_user_id: data.pic_user_id ?? previous.pic_user_id,
            version_number: data.version_number ?? null,
            tags: data.tags ?? previous.tags,
            notes: data.notes ?? previous.notes,
            access_scope: data.access_scope ?? previous.access_scope,
        };

        const { rows: insertRows } = await c.query(
            `INSERT INTO hrga_legal_documents
               (legal_document_record_number, document_category, document_subcategory,
                document_name, document_number, document_year,
                issue_date, expiry_date,
                validity_period_start, validity_period_end,
                notary_name, related_customer_id, related_principal,
                pic_user_id, version_number, document_status,
                tags, notes, access_scope,
                reminder_90_days_at, reminder_30_days_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     $11,$12,$13,$14,$15,'Active',
                     COALESCE($16, ARRAY[]::text[]),$17, COALESCE($18,'hrga_only'),
                     $19,$20,$21,$21)
             RETURNING *`,
            [
                recordNumber,
                next.document_category, next.document_subcategory,
                next.document_name, next.document_number, next.document_year,
                next.issue_date, next.expiry_date,
                next.validity_period_start, next.validity_period_end,
                next.notary_name, next.related_customer_id, next.related_principal,
                next.pic_user_id, next.version_number,
                next.tags, next.notes, next.access_scope,
                reminder90, reminder30, actor.id,
            ],
        );
        const newDoc = insertRows[0];

        await c.query(
            `UPDATE hrga_legal_documents
                SET document_status  = 'Superseded',
                    superseded_by_id = $2,
                    updated_by       = $3,
                    updated_at       = now()
              WHERE id = $1`,
            [previous.id, newDoc.id, actor.id],
        );

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'hrga.legal_documents', newDoc.id,
            );
        }
        return { previous: { id: previous.id, document_status: 'Superseded' }, current: newDoc };
    });
}

async function deleteLegalDocument(id, actor) {
    const existing = await requireRow('hrga_legal_documents', id);
    if (existing.document_status === 'Active'
        && existing.expiry_date
        && new Date(existing.expiry_date) > new Date()) {
        throw new ConflictError(
            `Active legal document ${existing.legal_document_record_number} cannot be soft-deleted while still valid; supersede or archive first`,
        );
    }
    await db.query(
        `UPDATE hrga_legal_documents
            SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

/**
 * Archive a legal document. Creates a mirror row in hrga_archive_records
 * (keeping the source row discoverable via Smart Search) and flips the
 * source row's document_status to 'Archived' with archived_at=now().
 */
async function archiveLegalDocument(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM hrga_legal_documents
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`hrga_legal_documents ${id} not found`);
        }
        const doc = lockRows[0];
        if (doc.document_status === 'Archived') {
            throw new ConflictError(
                `Document ${doc.legal_document_record_number} is already archived`,
            );
        }

        const archive = await insertArchiveMirror(c, {
            sourceModule: 'legalitas',
            sourceRecordId: doc.id,
            documentName: doc.document_name,
            documentCategory: doc.document_category,
            archiveReason: data.archive_reason,
            notes: data.notes,
            accessScope: data.access_scope || 'hrga_only',
            attachmentIds: [],
            actor,
        });

        await c.query(
            `UPDATE hrga_legal_documents
                SET document_status = 'Archived',
                    archived_at     = now(),
                    updated_by      = $2,
                    updated_at      = now()
              WHERE id = $1`,
            [doc.id, actor.id],
        );
        return { archive, source: { id: doc.id, document_status: 'Archived' } };
    });
}

// ============================================================================
// COMPANY LETTERS
// ============================================================================

async function listCompanyLetters({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.letter_status) {
        extraFilters.push({ sql: 'letter_status = $X', value: query.letter_status });
    }
    if (query.letter_type) {
        extraFilters.push({ sql: 'letter_type = $X', value: query.letter_type });
    }
    if (query.signatory_user_id) {
        extraFilters.push({ sql: 'signatory_user_id = $X', value: query.signatory_user_id });
    }
    if (query.related_employee_id) {
        extraFilters.push({ sql: 'related_employee_id = $X', value: query.related_employee_id });
    }
    return listRows({
        table: 'company_letters',
        search: query.search,
        searchColumn: 'subject',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getCompanyLetter(id) {
    return requireRow('company_letters', id);
}

async function createCompanyLetter(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'company_letters', 'letter_record_number',
            HRGA_PREFIXES.COMPANY_LETTER,
        );

        const { rows } = await c.query(
            `INSERT INTO company_letters
               (letter_record_number, letter_type, letter_number, subject,
                related_employee_id, recipient_name, recipient_role_or_department,
                issue_date, effective_date, reference_number,
                signatory_user_id, template_reference_id,
                letter_status, tags, notes, access_scope,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                     COALESCE($13,'Draft'),
                     COALESCE($14, ARRAY[]::text[]),$15,
                     COALESCE($16,'hrga_only'),$17,$17)
             RETURNING *`,
            [
                recordNumber, data.letter_type, data.letter_number, data.subject,
                data.related_employee_id, data.recipient_name,
                data.recipient_role_or_department,
                data.issue_date, data.effective_date, data.reference_number,
                data.signatory_user_id, data.template_reference_id,
                data.letter_status, data.tags, data.notes, data.access_scope,
                actor.id,
            ],
        );
        const letter = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'hrga.company_letters', letter.id,
            );
        }
        return letter;
    });
}

async function updateCompanyLetter(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM company_letters
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`company_letters ${id} not found`);
        }
        const before = lockRows[0];
        if (before.letter_status === 'Archived') {
            throw new ConflictError(
                `Letter ${before.letter_record_number} is archived; cannot edit`,
            );
        }

        const { rows } = await c.query(
            `UPDATE company_letters SET
                letter_type                  = COALESCE($2, letter_type),
                letter_number                = COALESCE($3, letter_number),
                subject                      = COALESCE($4, subject),
                related_employee_id          = COALESCE($5, related_employee_id),
                recipient_name               = COALESCE($6, recipient_name),
                recipient_role_or_department = COALESCE($7, recipient_role_or_department),
                issue_date                   = COALESCE($8, issue_date),
                effective_date               = COALESCE($9, effective_date),
                reference_number             = COALESCE($10, reference_number),
                signatory_user_id            = COALESCE($11, signatory_user_id),
                template_reference_id        = COALESCE($12, template_reference_id),
                letter_status                = COALESCE($13, letter_status),
                tags                         = COALESCE($14::text[], tags),
                notes                        = COALESCE($15, notes),
                access_scope                 = COALESCE($16, access_scope),
                updated_by                   = $17,
                updated_at                   = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.letter_type, data.letter_number, data.subject,
                data.related_employee_id, data.recipient_name,
                data.recipient_role_or_department,
                data.issue_date, data.effective_date, data.reference_number,
                data.signatory_user_id, data.template_reference_id,
                data.letter_status, data.tags || null, data.notes,
                data.access_scope, actor.id,
            ],
        );
        const after = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'hrga.company_letters', after.id,
            );
        }

        // Emit lifecycle notifications on status transitions.
        await emitLetterTransitionNotification(c, before, after, actor);

        return after;
    });
}

async function emitLetterTransitionNotification(client, before, after, actor) {
    if (!after) return;
    const prevStatus = before ? before.letter_status : null;
    const newStatus = after.letter_status;
    if (prevStatus === newStatus) return;

    if (newStatus === 'Under Review') {
        await notificationService.emit(client, {
            templateKey: 'hrga.letter.review_requested',
            title: `Letter ${after.letter_record_number} submitted for review`,
            message: `Subject: ${after.subject}`,
            module: 'hrga',
            entityType: 'company_letters',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['hrga'],
        });
    } else if (newStatus === 'Final') {
        await notificationService.emit(client, {
            templateKey: 'hrga.letter.finalized',
            title: `Letter ${after.letter_record_number} finalized`,
            message: `Subject: ${after.subject}`,
            module: 'hrga',
            entityType: 'company_letters',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['hrga', 'superadmin', 'ceo'],
        });
    }
}

/**
 * Dedicated status-transition endpoint. Enforces forward-only progression
 * along Draft → Under Review → Final → Sent → Archived so a reviewer can't
 * silently walk a Final letter back to Draft. Archive transitions go
 * through archiveCompanyLetter() to also mirror into hrga_archive_records.
 */
async function transitionCompanyLetter(id, input, actor) {
    const ORDER = {
        Draft: 0,
        'Under Review': 1,
        Final: 2,
        Sent: 3,
        Archived: 4,
    };

    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM company_letters
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`company_letters ${id} not found`);
        }
        const before = lockRows[0];
        if (ORDER[input.letter_status] < ORDER[before.letter_status]) {
            throw new ConflictError(
                `Cannot move letter status '${before.letter_status}' → '${input.letter_status}'`,
            );
        }
        if (input.letter_status === 'Archived') {
            throw new BadRequestError(
                'Use POST /api/hrga/archive or the archive endpoint to archive a letter',
            );
        }

        const { rows } = await c.query(
            `UPDATE company_letters
                SET letter_status = $2,
                    notes         = COALESCE($3, notes),
                    updated_by    = $4,
                    updated_at    = now()
              WHERE id = $1
              RETURNING *`,
            [id, input.letter_status, input.note || null, actor.id],
        );
        const after = rows[0];

        await emitLetterTransitionNotification(c, before, after, actor);
        return after;
    });
}

async function archiveCompanyLetter(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM company_letters
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`company_letters ${id} not found`);
        }
        const letter = lockRows[0];
        if (letter.letter_status === 'Archived') {
            throw new ConflictError(
                `Letter ${letter.letter_record_number} is already archived`,
            );
        }

        const archive = await insertArchiveMirror(c, {
            sourceModule: 'company_letters',
            sourceRecordId: letter.id,
            documentName: letter.subject,
            documentCategory: letter.letter_type,
            archiveReason: data.archive_reason,
            notes: data.notes,
            accessScope: data.access_scope || 'hrga_only',
            attachmentIds: [],
            actor,
        });

        await c.query(
            `UPDATE company_letters
                SET letter_status = 'Archived',
                    updated_by    = $2,
                    updated_at    = now()
              WHERE id = $1`,
            [letter.id, actor.id],
        );
        return { archive, source: { id: letter.id, letter_status: 'Archived' } };
    });
}

async function deleteCompanyLetter(id, actor) {
    const existing = await requireRow('company_letters', id);
    if (existing.letter_status === 'Final' || existing.letter_status === 'Sent') {
        throw new ConflictError(
            `${existing.letter_status} letter ${existing.letter_record_number} cannot be soft-deleted; archive it instead`,
        );
    }
    await db.query(
        `UPDATE company_letters
            SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// LETTER TEMPLATES
// ============================================================================

async function listLetterTemplates({ query }) {
    const { page, limit, offset } = parsePagination(query);
    const clauses = [];
    const params = [];
    if (query.letter_type) {
        params.push(query.letter_type);
        clauses.push(`letter_type = $${params.length}`);
    }
    if (query.search) {
        params.push(`%${query.search}%`);
        clauses.push(`template_name ILIKE $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM letter_templates ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT * FROM letter_templates ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function getLetterTemplate(id) {
    const { rows } = await db.query(
        `SELECT * FROM letter_templates WHERE id = $1`,
        [id],
    );
    if (rows.length === 0) throw new NotFoundError(`letter_templates ${id} not found`);
    return rows[0];
}

async function createLetterTemplate(data, actor) {
    const { rows } = await db.query(
        `INSERT INTO letter_templates
           (template_name, letter_type, body_html, created_by)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [data.template_name, data.letter_type, data.body_html, actor.id],
    );
    return rows[0];
}

async function updateLetterTemplate(id, data) {
    // letter_templates has no updated_at / updated_by columns per migration
    // 009 — templates are effectively versioned by creating new rows.
    const { rows } = await db.query(
        `UPDATE letter_templates SET
            template_name = COALESCE($2, template_name),
            letter_type   = COALESCE($3, letter_type),
            body_html     = COALESCE($4, body_html)
          WHERE id = $1
          RETURNING *`,
        [id, data.template_name, data.letter_type, data.body_html],
    );
    if (rows.length === 0) throw new NotFoundError(`letter_templates ${id} not found`);
    return rows[0];
}

async function deleteLetterTemplate(id) {
    // Hard-delete: letter_templates has no deleted_at column. Referencing
    // company_letters rows have ON DELETE SET NULL on template_reference_id.
    const { rowCount } = await db.query(
        `DELETE FROM letter_templates WHERE id = $1`,
        [id],
    );
    if (rowCount === 0) throw new NotFoundError(`letter_templates ${id} not found`);
}

// ============================================================================
// ARCHIVE & REPOSITORY
// ============================================================================

async function insertArchiveMirror(client, {
    sourceModule, sourceRecordId, documentName, documentCategory,
    archiveReason, notes, accessScope, attachmentIds = [], actor,
}) {
    const recordNumber = await nextRecordNumber(
        client, 'hrga_archive_records', 'archive_record_number',
        HRGA_PREFIXES.ARCHIVE,
    );
    const { rows } = await client.query(
        `INSERT INTO hrga_archive_records
           (archive_record_number, source_module, source_record_id,
            document_name, document_category, archive_reason,
            archived_by_user_id, notes, access_scope)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'hrga_only'))
         RETURNING *`,
        [
            recordNumber, sourceModule, sourceRecordId,
            documentName, documentCategory, archiveReason,
            actor.id, notes, accessScope,
        ],
    );
    const archive = rows[0];
    if (attachmentIds.length > 0) {
        await attachFilesToEntity(
            client, attachmentIds, 'hrga.archive', archive.id,
        );
    }
    return archive;
}

async function listArchive({ query }) {
    const { page, limit, offset } = parsePagination(query);
    const clauses = [];
    const params = [];
    if (query.search) {
        params.push(`%${query.search}%`);
        clauses.push(`document_name ILIKE $${params.length}`);
    }
    if (query.source_module) {
        params.push(query.source_module);
        clauses.push(`source_module = $${params.length}`);
    }
    if (query.archive_reason) {
        params.push(query.archive_reason);
        clauses.push(`archive_reason = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM hrga_archive_records ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT * FROM hrga_archive_records ${where}
          ORDER BY archived_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function getArchiveRecord(id) {
    const { rows } = await db.query(
        `SELECT * FROM hrga_archive_records WHERE id = $1`,
        [id],
    );
    if (rows.length === 0) throw new NotFoundError(`hrga_archive_records ${id} not found`);
    return rows[0];
}

async function createArchive(data, actor) {
    return db.withTransaction(async (c) => {
        // Validate the source row exists — soft pointer, not a FK.
        let sourceRow = null;
        if (data.source_module === 'legalitas') {
            sourceRow = await requireRow('hrga_legal_documents', data.source_record_id, c);
        } else if (data.source_module === 'company_letters') {
            sourceRow = await requireRow('company_letters', data.source_record_id, c);
        }

        const archive = await insertArchiveMirror(c, {
            sourceModule: data.source_module,
            sourceRecordId: data.source_record_id,
            documentName: data.document_name
                || sourceRow?.document_name
                || sourceRow?.subject
                || null,
            documentCategory: data.document_category
                || sourceRow?.document_category
                || sourceRow?.letter_type
                || null,
            archiveReason: data.archive_reason,
            notes: data.notes,
            accessScope: data.access_scope || 'hrga_only',
            attachmentIds: data.attachment_ids || [],
            actor,
        });

        // Keep the source row in sync so it can't drift out of archived state
        // (mirrors archiveLegalDocument / archiveCompanyLetter behaviour).
        if (data.source_module === 'legalitas' && sourceRow) {
            await c.query(
                `UPDATE hrga_legal_documents
                    SET document_status = 'Archived',
                        archived_at     = now(),
                        updated_by      = $2,
                        updated_at      = now()
                  WHERE id = $1`,
                [sourceRow.id, actor.id],
            );
        } else if (data.source_module === 'company_letters' && sourceRow) {
            await c.query(
                `UPDATE company_letters
                    SET letter_status = 'Archived',
                        updated_by    = $2,
                        updated_at    = now()
                  WHERE id = $1`,
                [sourceRow.id, actor.id],
            );
        }

        return archive;
    });
}

async function updateArchive(id, data) {
    const { rows } = await db.query(
        `UPDATE hrga_archive_records SET
            document_name     = COALESCE($2, document_name),
            document_category = COALESCE($3, document_category),
            archive_reason    = COALESCE($4, archive_reason),
            notes             = COALESCE($5, notes),
            access_scope      = COALESCE($6, access_scope)
          WHERE id = $1
          RETURNING *`,
        [
            id, data.document_name, data.document_category,
            data.archive_reason, data.notes, data.access_scope,
        ],
    );
    if (rows.length === 0) throw new NotFoundError(`hrga_archive_records ${id} not found`);
    return rows[0];
}

async function deleteArchive(id) {
    const { rowCount } = await db.query(
        `DELETE FROM hrga_archive_records WHERE id = $1`,
        [id],
    );
    if (rowCount === 0) throw new NotFoundError(`hrga_archive_records ${id} not found`);
}

// ============================================================================
// SMART SEARCH
// ============================================================================

/**
 * Determine which categories the caller may see.
 *   - superadmin / ceo / hrga → full visibility (no access_scope filter)
 *   - any other role          → only rows with access_scope='all_roles'
 *     (specific_roles is reserved for a future role-membership table; for
 *     now it is treated as hrga_only in the unauthorized direction).
 */
function accessScopeClause(role) {
    if (role === 'superadmin' || role === 'ceo' || role === 'hrga') {
        return 'TRUE';
    }
    return "access_scope = 'all_roles'";
}

/**
 * Unified Smart Search. Builds a UNION of three normalized result shapes
 * (legal document, letter, archive mirror) and applies the shared filter
 * set on each branch. Postgres FTS (`search_document @@ to_tsquery(...)`)
 * powers the keyword arm, falling back to ILIKE if the caller passed no
 * keyword. Role-gated access_scope trims non-HRGA roles to the explicit
 * all_roles slice.
 */
async function smartSearch({ query, actor }) {
    const { page, limit, offset } = parsePagination(query);
    const includeArchive = query.include_archive !== false;

    const params = [];

    function pushParam(value) {
        params.push(value);
        return `$${params.length}`;
    }

    const keywordRaw = (query.keyword || '').trim();
    const hasKeyword = keywordRaw.length > 0;

    // Build per-source WHERE fragments.
    function buildLegalClauses() {
        const cl = ['deleted_at IS NULL'];
        if (hasKeyword) {
            const p = pushParam(toTsqueryInput(keywordRaw));
            cl.push(`search_document @@ to_tsquery('simple', ${p})`);
        }
        if (query.document_category) {
            cl.push(`document_category = ${pushParam(query.document_category)}`);
        }
        if (query.document_subcategory) {
            cl.push(`document_subcategory = ${pushParam(query.document_subcategory)}`);
        }
        if (query.document_number) {
            cl.push(`document_number ILIKE ${pushParam(`%${query.document_number}%`)}`);
        }
        if (query.year) {
            cl.push(`document_year = ${pushParam(query.year)}`);
        }
        if (query.issue_date_from) {
            cl.push(`issue_date >= ${pushParam(query.issue_date_from)}`);
        }
        if (query.issue_date_to) {
            cl.push(`issue_date <= ${pushParam(query.issue_date_to)}`);
        }
        if (query.expiry_date_from) {
            cl.push(`expiry_date >= ${pushParam(query.expiry_date_from)}`);
        }
        if (query.expiry_date_to) {
            cl.push(`expiry_date <= ${pushParam(query.expiry_date_to)}`);
        }
        if (query.pic_user_id) {
            cl.push(`pic_user_id = ${pushParam(query.pic_user_id)}`);
        }
        if (query.related_customer_id) {
            cl.push(`related_customer_id = ${pushParam(query.related_customer_id)}`);
        }
        if (query.notary_name) {
            cl.push(`notary_name ILIKE ${pushParam(`%${query.notary_name}%`)}`);
        }
        if (query.status) {
            cl.push(`document_status = ${pushParam(query.status)}`);
        }
        if (query.tag) {
            cl.push(`${pushParam(query.tag)}::text = ANY(tags)`);
        }
        cl.push(accessScopeClause(actor.role));
        return cl.join(' AND ');
    }

    function buildLetterClauses() {
        const cl = ['deleted_at IS NULL'];
        if (hasKeyword) {
            const p = pushParam(toTsqueryInput(keywordRaw));
            cl.push(`search_document @@ to_tsquery('simple', ${p})`);
        }
        if (query.document_number) {
            cl.push(`letter_number ILIKE ${pushParam(`%${query.document_number}%`)}`);
        }
        if (query.issue_date_from) {
            cl.push(`issue_date >= ${pushParam(query.issue_date_from)}`);
        }
        if (query.issue_date_to) {
            cl.push(`issue_date <= ${pushParam(query.issue_date_to)}`);
        }
        if (query.related_employee_id) {
            cl.push(`related_employee_id = ${pushParam(query.related_employee_id)}`);
        }
        if (query.status) {
            cl.push(`letter_status = ${pushParam(query.status)}`);
        }
        if (query.tag) {
            cl.push(`${pushParam(query.tag)}::text = ANY(tags)`);
        }
        cl.push(accessScopeClause(actor.role));
        return cl.join(' AND ');
    }

    function buildArchiveClauses() {
        const cl = [];
        if (hasKeyword) {
            const p = pushParam(`%${keywordRaw}%`);
            cl.push(`(document_name ILIKE ${p} OR notes ILIKE ${p})`);
        }
        if (query.document_category) {
            cl.push(`document_category = ${pushParam(query.document_category)}`);
        }
        cl.push(accessScopeClause(actor.role));
        return cl.length > 0 ? cl.join(' AND ') : 'TRUE';
    }

    const legalWhere = buildLegalClauses();
    const letterWhere = buildLetterClauses();
    const archiveWhere = includeArchive ? buildArchiveClauses() : null;

    const unionParts = [];
    unionParts.push(`
        SELECT
            'legalitas'::text                AS source_module,
            id,
            legal_document_record_number     AS record_number,
            document_name                    AS display_name,
            document_category                AS category,
            document_subcategory             AS subcategory,
            document_number,
            issue_date,
            expiry_date,
            document_status                  AS status,
            version_number                   AS version,
            compliance_flag,
            access_scope,
            tags,
            created_at
          FROM hrga_legal_documents
         WHERE ${legalWhere}
    `);
    unionParts.push(`
        SELECT
            'company_letters'::text          AS source_module,
            id,
            letter_record_number             AS record_number,
            subject                          AS display_name,
            letter_type                      AS category,
            NULL::text                       AS subcategory,
            letter_number                    AS document_number,
            issue_date,
            NULL::date                       AS expiry_date,
            letter_status                    AS status,
            NULL::text                       AS version,
            NULL::text                       AS compliance_flag,
            access_scope,
            tags,
            created_at
          FROM company_letters
         WHERE ${letterWhere}
    `);
    if (archiveWhere) {
        unionParts.push(`
            SELECT
                'archive'::text              AS source_module,
                id,
                archive_record_number        AS record_number,
                document_name                AS display_name,
                document_category            AS category,
                NULL::text                   AS subcategory,
                NULL::text                   AS document_number,
                NULL::date                   AS issue_date,
                NULL::date                   AS expiry_date,
                archive_reason               AS status,
                NULL::text                   AS version,
                NULL::text                   AS compliance_flag,
                access_scope,
                NULL::text[]                 AS tags,
                archived_at                  AS created_at
              FROM hrga_archive_records
             WHERE ${archiveWhere}
        `);
    }

    const unionSql = unionParts.map((part) => `(${part})`).join('\n UNION ALL \n');

    // Count query reuses the same WHERE fragments/params but wraps in a
    // sub-select so count(*) matches the final result set.
    const countParams = params.slice();
    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM (${unionSql}) AS hrga_search`,
        countParams,
    );
    const total = countRes.rows[0].c;

    const limitIdx = pushParam(limit);
    const offsetIdx = pushParam(offset);
    const { rows } = await db.query(
        `SELECT * FROM (${unionSql}) AS hrga_search
          ORDER BY created_at DESC
          LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

// Translate user keyword into a to_tsquery-safe prefix expression. Replaces
// whitespace with ' & ' and strips characters that confuse the parser.
function toTsqueryInput(raw) {
    const cleaned = raw
        .replace(/[!&|:*()<>]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `${t}:*`)
        .join(' & ');
    return cleaned || raw;
}

// ============================================================================
// COMPLIANCE / EXPIRY
// ============================================================================

async function listExpiringDocuments({ query }) {
    const { page, limit, offset } = parsePagination(query);
    const withinDays = Number.isFinite(query.within_days) ? query.within_days : 90;
    const params = [withinDays];
    const clauses = [
        'deleted_at IS NULL',
        "document_status NOT IN ('Archived','Superseded')",
        'expiry_date IS NOT NULL',
        "expiry_date <= (CURRENT_DATE + ($1 || ' days')::interval)",
    ];
    if (query.compliance_flag) {
        params.push(query.compliance_flag);
        clauses.push(`compliance_flag = $${params.length}`);
    }
    const where = clauses.join(' AND ');

    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM hrga_legal_documents WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT id, legal_document_record_number, document_name, document_category,
                document_subcategory, expiry_date, document_status, compliance_flag,
                pic_user_id, reminder_90_days_at, reminder_30_days_at, expired_at
           FROM hrga_legal_documents
          WHERE ${where}
          ORDER BY expiry_date ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function complianceDashboardCounts() {
    const { rows } = await db.query(
        `SELECT compliance_flag, count(*)::int AS count
           FROM hrga_legal_documents
          WHERE deleted_at IS NULL
            AND document_status NOT IN ('Archived','Superseded')
          GROUP BY compliance_flag`,
    );
    const counts = {
        ok: 0, expiring_soon_90: 0, expiring_soon_30: 0, expired: 0,
    };
    for (const row of rows) {
        if (counts[row.compliance_flag] !== undefined) {
            counts[row.compliance_flag] = row.count;
        }
    }
    return counts;
}

module.exports = {
    // Legalitas
    listLegalDocuments, getLegalDocument, createLegalDocument,
    updateLegalDocument, supersedeLegalDocument, archiveLegalDocument,
    deleteLegalDocument,

    // Company Letters
    listCompanyLetters, getCompanyLetter, createCompanyLetter,
    updateCompanyLetter, transitionCompanyLetter, archiveCompanyLetter,
    deleteCompanyLetter,

    // Letter Templates
    listLetterTemplates, getLetterTemplate, createLetterTemplate,
    updateLetterTemplate, deleteLetterTemplate,

    // Archive
    listArchive, getArchiveRecord, createArchive, updateArchive, deleteArchive,

    // Smart Search / Compliance
    smartSearch, listExpiringDocuments, complianceDashboardCounts,

    // helpers exposed for job + testing
    insertArchiveMirror, computeExpiryReminders,
};

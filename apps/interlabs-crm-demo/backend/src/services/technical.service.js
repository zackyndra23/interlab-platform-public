'use strict';

const db = require('../config/database');
const poService = require('./po.service');
const financeService = require('./finance.service');
const notificationService = require('./notification.service');
const { nextRecordNumber, TECHNICAL_PREFIXES } = require('../utils/recordNumbers');
const { parsePagination, buildMeta } = require('../utils/pagination');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// Technical module service layer.
//
// Owns PO lifecycle stages Inspected, Installation, BAST. Every stage
// transition flows through poService.advanceStatus so the four invariants
// from CLAUDE.md stay intact (history + tracking + notification + current_status).
//
// Form-by-form trigger summary (MOD_technical.txt):
//
//   INSTALLATION (§FORM 2)
//     inspection_status='Complete' + function_test_status='Pass' → PO Inspected
//        + emit technical.po.inspected
//     installation_start_date (null → present) → PO Installation
//        + emit technical.po.installation
//     ready_to_deliver='Yes' (null/No → Yes) → admin_log_response_status=pending,
//        ready_to_deliver_at=now(), emit technical.installation.ready_to_deliver
//        Starts the 2-working-day Admin & Log SLA clock.
//     bast_upload_file_ids provided → create invoice_customers draft via
//        financeService.createInvoiceCustomerDraftFromBast, advance PO to BAST,
//        emit technical.bast.submitted + finance.invoice_customer.registered.
//
//   PM (§FORM 3)
//     bastp_file_ids provided → same BAST handoff as Installation (creates
//        Invoice Customer draft + advances PO to BAST).
//
//   SPAREPART (§FORM 4)
//     ready_to_deliver='Yes' → identical SLA wire-up to Installation.
//     billing_support_file_ids provided → emit technical.billing.handoff
//        to Finance (no PO-stage change).
//
//   INSPECTION & QC (§FORM 5)
//     final_submit_status='Submitted' + review_status='Approved' → PO Inspected
//        + emit technical.qc.completed.
//
//   BAST (§FORM 6)
//     workflow_status='submitted' (via /send-to-finance) → sent_to_finance=true,
//        create Invoice Customer draft, advance PO to BAST, emit
//        technical.bast.submitted + finance.invoice_customer.registered.

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

async function lookupPoNumber(client, poId) {
    const { rows } = await client.query(
        `SELECT po_number, customer_id, due_at
           FROM purchase_orders
          WHERE id = $1 AND deleted_at IS NULL`,
        [poId],
    );
    if (rows.length === 0) {
        throw new BadRequestError(`purchase_orders ${poId} not found or deleted`);
    }
    return rows[0];
}

// Resolve the Finance-side PO Customer linked to a master PO. Needed when
// creating an Invoice Customer draft from Technical — financeService wants
// the poCustomerId so the draft joins back to the Sales-originated record.
async function resolvePoCustomer(client, masterPoId) {
    const { rows } = await client.query(
        `SELECT id, customer_id
           FROM po_customer_records
          WHERE related_po_id = $1 AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1`,
        [masterPoId],
    );
    return rows[0] || null;
}

/**
 * Materialize a real bast_records row for an auto-handoff flow (Installation
 * bast_upload_file_ids, PM bastp_file_ids). Required because
 * invoice_customers.related_bast_id is FK-constrained to bast_records(id);
 * the Finance Invoice Customer draft insert would otherwise fail.
 *
 * The created BAST row is marked sent_to_finance=true / workflow_status=
 * 'sent_to_finance' immediately, because this code path only runs *as part
 * of* the handoff — there is no interim draft state to preserve.
 *
 * Attachment IDs passed in are bound to the new BAST row so their
 * related_entity_id matches the canonical BAST record. Callers MUST be
 * inside a transaction (the record-number advisory lock in
 * nextRecordNumber requires it).
 */
async function createBastRecordForHandoff(client, {
    jobType, relatedJobOrderId, relatedPoId, customerId,
    attachmentIds = [], scopeSummary, actor,
}) {
    const recordNumber = await nextRecordNumber(
        client, 'bast_records', 'bast_record_number', TECHNICAL_PREFIXES.BAST,
    );

    const { rows } = await client.query(
        `INSERT INTO bast_records
           (bast_record_number, related_job_order_id, related_po_id,
            customer_id, job_type, scope_summary,
            sent_to_finance, sent_to_finance_at,
            workflow_status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6, true, now(), 'sent_to_finance',$7,$7)
         RETURNING *`,
        [
            recordNumber, relatedJobOrderId, relatedPoId,
            customerId, jobType, scopeSummary, actor.id,
        ],
    );
    const bast = rows[0];

    if (attachmentIds.length > 0) {
        await attachFilesToEntity(client, attachmentIds, 'technical.bast', bast.id);
    }
    return bast;
}

// ============================================================================
// TECHNICAL JOB ORDER
// ============================================================================

async function listJobOrders({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_status) {
        extraFilters.push({ sql: 'workflow_status = $X', value: query.workflow_status });
    }
    if (query.job_type) {
        extraFilters.push({ sql: 'job_type = $X', value: query.job_type });
    }
    if (query.assigned_engineer_id) {
        extraFilters.push({
            sql: 'assigned_engineer_id = $X',
            value: query.assigned_engineer_id,
        });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    if (query.due_date_reminder_flag !== undefined) {
        extraFilters.push({
            sql: 'due_date_reminder_flag = $X',
            value: query.due_date_reminder_flag,
        });
    }
    return listRows({
        table: 'technical_job_orders',
        search: query.search,
        searchColumn: 'technical_job_order_number',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getJobOrder(id) {
    return requireRow('technical_job_orders', id);
}

async function createJobOrder(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'technical_job_orders', 'technical_job_order_number',
            TECHNICAL_PREFIXES.JOB_ORDER,
        );
        const po = await lookupPoNumber(c, data.related_po_id);
        const relatedPoNumber = data.related_po_number || po.po_number;
        const poDueDate = data.po_due_date || po.due_at;

        const { rows } = await c.query(
            `INSERT INTO technical_job_orders
               (technical_job_order_number, related_po_id, related_po_number,
                customer_id, job_type,
                planned_start_date, planned_end_date,
                work_duration_start, work_duration_end,
                assigned_engineer_id, support_team_members,
                site_location, product_or_equipment_name, serial_number,
                priority, current_technical_status,
                po_due_date, notes, workflow_status,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],
                     $12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
             RETURNING *`,
            [
                recordNumber, data.related_po_id, relatedPoNumber,
                data.customer_id || po.customer_id, data.job_type,
                data.planned_start_date, data.planned_end_date,
                data.work_duration_start, data.work_duration_end,
                data.assigned_engineer_id,
                data.support_team_members || [],
                data.site_location, data.product_or_equipment_name, data.serial_number,
                data.priority, data.current_technical_status,
                poDueDate, data.notes, data.workflow_status || 'draft',
                actor.id,
            ],
        );
        const jo = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'technical.job_orders', jo.id,
            );
        }

        // Fire technical.job_order.created — recipients per MOD_technical
        // §NOTIFICATION EVENTS: Technical (assigned engineer + team),
        // Superadmin, CEO. Emit directly to the engineer user_ids when
        // present so a Technical-role user who happens not to be assigned
        // isn't forced to subscribe.
        const extraRecipientUserIds = [
            jo.assigned_engineer_id,
            ...(jo.support_team_members || []),
        ].filter(Boolean);

        await notificationService.emit(c, {
            templateKey: 'technical.job_order.created',
            title: `Technical Job Order ${jo.technical_job_order_number} created`,
            message: `Job Order ${jo.technical_job_order_number} linked to PO `
                + `${jo.related_po_number} (${jo.job_type}).`,
            module: 'technical',
            entityType: 'technical_job_orders',
            entityId: jo.id,
            senderUserId: actor.id,
            extraRecipientUserIds,
            extraRoles: ['technical', 'superadmin', 'ceo'],
        });

        return jo;
    });
}

async function updateJobOrder(id, data, actor) {
    return db.withTransaction(async (c) => {
        const existing = await requireRow('technical_job_orders', id, c);
        if (existing.workflow_status === 'completed' || existing.workflow_status === 'cancelled') {
            throw new ConflictError(
                `Job Order ${existing.technical_job_order_number} is ${existing.workflow_status}; cannot edit`,
            );
        }

        // If related_po_id changes, refresh the denormalized snapshot fields.
        let relatedPoNumber = data.related_po_number;
        let poDueDate = data.po_due_date;
        if (data.related_po_id && data.related_po_id !== existing.related_po_id) {
            const po = await lookupPoNumber(c, data.related_po_id);
            relatedPoNumber = relatedPoNumber || po.po_number;
            poDueDate = poDueDate || po.due_at;
        }

        const { rows } = await c.query(
            `UPDATE technical_job_orders SET
                related_po_id             = COALESCE($2, related_po_id),
                related_po_number         = COALESCE($3, related_po_number),
                customer_id               = COALESCE($4, customer_id),
                job_type                  = COALESCE($5, job_type),
                planned_start_date        = COALESCE($6, planned_start_date),
                planned_end_date          = COALESCE($7, planned_end_date),
                work_duration_start       = COALESCE($8, work_duration_start),
                work_duration_end         = COALESCE($9, work_duration_end),
                assigned_engineer_id      = COALESCE($10, assigned_engineer_id),
                support_team_members      = COALESCE($11::uuid[], support_team_members),
                site_location             = COALESCE($12, site_location),
                product_or_equipment_name = COALESCE($13, product_or_equipment_name),
                serial_number             = COALESCE($14, serial_number),
                priority                  = COALESCE($15, priority),
                current_technical_status  = COALESCE($16, current_technical_status),
                po_due_date               = COALESCE($17, po_due_date),
                notes                     = COALESCE($18, notes),
                workflow_status           = COALESCE($19, workflow_status),
                updated_by                = $20,
                updated_at                = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_po_id, relatedPoNumber, data.customer_id,
                data.job_type, data.planned_start_date, data.planned_end_date,
                data.work_duration_start, data.work_duration_end,
                data.assigned_engineer_id,
                data.support_team_members || null,
                data.site_location, data.product_or_equipment_name, data.serial_number,
                data.priority, data.current_technical_status, poDueDate,
                data.notes, data.workflow_status, actor.id,
            ],
        );

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'technical.job_orders', id,
            );
        }
        return rows[0];
    });
}

async function deleteJobOrder(id, actor) {
    const existing = await requireRow('technical_job_orders', id);
    if (existing.workflow_status === 'active') {
        throw new ConflictError(
            `Cannot delete active Job Order ${existing.technical_job_order_number}`,
        );
    }
    await db.query(
        `UPDATE technical_job_orders SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// INSTALLATION
// ============================================================================

async function listInstallations({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_phase) {
        extraFilters.push({ sql: 'workflow_phase = $X', value: query.workflow_phase });
    }
    if (query.admin_log_response_status) {
        extraFilters.push({
            sql: 'admin_log_response_status = $X',
            value: query.admin_log_response_status,
        });
    }
    if (query.related_job_order_id) {
        extraFilters.push({ sql: 'related_job_order_id = $X', value: query.related_job_order_id });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    return listRows({
        table: 'installation_records',
        search: query.search,
        searchColumn: 'related_job_order_id',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getInstallation(id) {
    return requireRow('installation_records', id);
}

/**
 * Run the trigger-field automation for an installation_records write.
 *
 * `before` is the pre-update row (null on INSERT); `after` is the post-write
 * row. The four triggers are evaluated in dependency order:
 *
 *   1. Inspection complete + function test pass → PO Inspected
 *   2. installation_start_date first populated → PO Installation
 *   3. ready_to_deliver transitions to 'Yes'   → set RTD timestamp + notify
 *   4. bast_upload_file_ids provided           → BAST handoff to Finance
 *
 * Each trigger is independent; multiple may fire in a single save. Forward
 * motion only is enforced by poService.advanceStatus, so (1)/(2)/(4) are
 * safe even if the caller mixes them in one request.
 */
async function runInstallationAutomation(client, {
    before, after, actor, input,
}) {
    const justBecameTrue = (field, truthy) =>
        after[field] === truthy && (!before || before[field] !== truthy);

    const becamePresent = (field) =>
        !(before && before[field]) && Boolean(after[field]);

    const events = { inspected: false, installation: false, rtd: false, bast: false };

    // --- Trigger 1: Inspected -------------------------------------------------
    const passedInspection = after.inspection_status === 'Complete'
        && after.function_test_status === 'Pass';
    const wasPassed = before
        && before.inspection_status === 'Complete'
        && before.function_test_status === 'Pass';
    if (passedInspection && !wasPassed && after.related_po_id) {
        await poService.advanceStatus(client, {
            poId: after.related_po_id,
            newStatus: 'Inspected',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: `Installation ${after.id}: inspection Complete + function test Pass`,
            extraRoles: ['admin_log', 'finance', 'superadmin', 'ceo'],
        });
        events.inspected = true;
    }

    // --- Trigger 2: Installation ---------------------------------------------
    if (becamePresent('installation_start_date') && after.related_po_id) {
        await poService.advanceStatus(client, {
            poId: after.related_po_id,
            newStatus: 'Installation',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: `On-site work started on ${after.installation_start_date}`,
            extraRoles: ['superadmin', 'ceo', 'sales'],
        });
        events.installation = true;
    }

    // --- Trigger 3: Ready-to-Deliver -----------------------------------------
    if (justBecameTrue('ready_to_deliver', 'Yes')) {
        await client.query(
            `UPDATE installation_records
                SET ready_to_deliver_at       = COALESCE(ready_to_deliver_at, now()),
                    admin_log_response_status = 'pending',
                    workflow_phase            = CASE
                        WHEN workflow_phase IN ('pre_installation','workshop')
                            THEN 'ready_to_deliver'
                        ELSE workflow_phase
                    END,
                    updated_by                = $1,
                    updated_at                = now()
              WHERE id = $2`,
            [actor.id, after.id],
        );

        // Clear any stale SLA reminder state so the monitor can re-fire.
        await client.query(
            `UPDATE sla_tracking
                SET overdue_at         = NULL,
                    escalation_sent_at = NULL
              WHERE entity_type = 'installation_records.ready_to_deliver'
                AND entity_id   = $1`,
            [after.id],
        );

        await notificationService.emit(client, {
            templateKey: 'technical.installation.ready_to_deliver',
            title: `Installation ${after.id} Ready to Deliver`,
            message: `Technical has marked the installation ready for `
                + `${after.delivery_method || 'delivery'}. 2-working-day `
                + 'Admin & Log response SLA starts now.',
            module: 'technical',
            entityType: 'installation_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['admin_log', 'superadmin', 'ceo'],
        });
        events.rtd = true;
    }

    // --- Trigger 4: BAST handoff ---------------------------------------------
    // Idempotency: workflow_phase='completed' is set by a prior successful
    // handoff. A second save that carries bast_upload_file_ids again is
    // treated as a no-op so we don't create duplicate BAST rows / invoice
    // drafts. Forward re-runs must go through the canonical BAST form.
    const bastFileIds = Array.isArray(input && input.bast_upload_file_ids)
        ? input.bast_upload_file_ids
        : [];
    const alreadyHandedOff = before && before.workflow_phase === 'completed';
    if (bastFileIds.length > 0 && after.related_po_id && !alreadyHandedOff) {
        const poCustomer = await resolvePoCustomer(client, after.related_po_id);

        // Persist a real bast_records row so invoice_customers.related_bast_id
        // can FK-reference it (FK constraint fk_invoice_customers_bast).
        // bind the uploaded attachments to the new BAST row's entity id.
        const bastRow = await createBastRecordForHandoff(client, {
            jobType: 'Installation',
            relatedJobOrderId: after.related_job_order_id,
            relatedPoId: after.related_po_id,
            customerId: poCustomer ? poCustomer.customer_id : null,
            attachmentIds: bastFileIds,
            scopeSummary: `Auto-generated from installation ${after.id} BAST upload`,
            actor,
        });

        await financeService.createInvoiceCustomerDraftFromBast(client, {
            bastRow,
            deliveryOrderRow: null,
            masterPoId: after.related_po_id,
            poCustomerId: poCustomer ? poCustomer.id : null,
            customerId: poCustomer ? poCustomer.customer_id : null,
            actor,
        });

        await poService.advanceStatus(client, {
            poId: after.related_po_id,
            newStatus: 'BAST',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: `BAST ${bastRow.bast_record_number} uploaded via installation ${after.id}`,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });

        await notificationService.emit(client, {
            templateKey: 'technical.bast.submitted',
            title: `BAST ${bastRow.bast_record_number} submitted`,
            message: 'Installation BAST documents uploaded; Finance invoice draft created.',
            module: 'technical',
            entityType: 'bast_records',
            entityId: bastRow.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });

        await client.query(
            `UPDATE installation_records
                SET workflow_phase = 'completed',
                    updated_by     = $1,
                    updated_at     = now()
              WHERE id = $2`,
            [actor.id, after.id],
        );
        events.bast = true;
    }

    return events;
}

async function createInstallation(data, actor) {
    return db.withTransaction(async (c) => {
        const jobOrder = await requireRow('technical_job_orders', data.related_job_order_id, c);

        const { rows } = await c.query(
            `INSERT INTO installation_records
               (related_job_order_id, related_po_id,
                pre_installation_status, local_part_request_needed,
                local_part_request_reference, finance_local_part_status,
                workshop_check_status, inspection_status,
                document_completeness_status, function_test_status,
                ready_to_deliver, delivery_method, admin_log_response_status,
                ready_to_deliver_at,
                installation_schedule_date, installation_start_date, installation_end_date,
                commissioning_included, training_included,
                workflow_phase, notes, created_by, updated_by)
             VALUES ($1,$2,
                     COALESCE($3,'Pending'),$4,$5,$6,
                     COALESCE($7,'Pending'), COALESCE($8,'Pending'),
                     $9, COALESCE($10,'Pending'),
                     $11,$12, COALESCE($13,'pending'),
                     $14,$15,$16,$17,$18,$19,
                     COALESCE($20,'pre_installation'),$21,$22,$22)
             RETURNING *`,
            [
                data.related_job_order_id, data.related_po_id || jobOrder.related_po_id,
                data.pre_installation_status, data.local_part_request_needed,
                data.local_part_request_reference, data.finance_local_part_status,
                data.workshop_check_status, data.inspection_status,
                data.document_completeness_status, data.function_test_status,
                data.ready_to_deliver, data.delivery_method,
                data.admin_log_response_status,
                data.ready_to_deliver_at,
                data.installation_schedule_date, data.installation_start_date,
                data.installation_end_date,
                data.commissioning_included, data.training_included,
                data.workflow_phase, data.notes, actor.id,
            ],
        );
        const installation = rows[0];

        if (data.qc_form_file_ids && data.qc_form_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.qc_form_file_ids, 'technical.installation_qc', installation.id,
            );
        }

        await runInstallationAutomation(c, {
            before: null, after: installation, actor, input: data,
        });

        const { rows: refetched } = await c.query(
            `SELECT * FROM installation_records WHERE id = $1`,
            [installation.id],
        );
        return refetched[0];
    });
}

async function updateInstallation(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM installation_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`installation_records ${id} not found`);
        }
        const before = lockRows[0];

        const { rows } = await c.query(
            `UPDATE installation_records SET
                pre_installation_status      = COALESCE($2, pre_installation_status),
                local_part_request_needed    = COALESCE($3, local_part_request_needed),
                local_part_request_reference = COALESCE($4, local_part_request_reference),
                finance_local_part_status    = COALESCE($5, finance_local_part_status),
                workshop_check_status        = COALESCE($6, workshop_check_status),
                inspection_status            = COALESCE($7, inspection_status),
                document_completeness_status = COALESCE($8, document_completeness_status),
                function_test_status         = COALESCE($9, function_test_status),
                ready_to_deliver             = COALESCE($10, ready_to_deliver),
                delivery_method              = COALESCE($11, delivery_method),
                installation_schedule_date   = COALESCE($12, installation_schedule_date),
                installation_start_date      = COALESCE($13, installation_start_date),
                installation_end_date        = COALESCE($14, installation_end_date),
                commissioning_included       = COALESCE($15, commissioning_included),
                training_included            = COALESCE($16, training_included),
                workflow_phase               = COALESCE($17, workflow_phase),
                notes                        = COALESCE($18, notes),
                updated_by                   = $19,
                updated_at                   = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.pre_installation_status, data.local_part_request_needed,
                data.local_part_request_reference, data.finance_local_part_status,
                data.workshop_check_status, data.inspection_status,
                data.document_completeness_status, data.function_test_status,
                data.ready_to_deliver, data.delivery_method,
                data.installation_schedule_date, data.installation_start_date,
                data.installation_end_date,
                data.commissioning_included, data.training_included,
                data.workflow_phase, data.notes, actor.id,
            ],
        );
        const after = rows[0];

        if (data.qc_form_file_ids && data.qc_form_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.qc_form_file_ids, 'technical.installation_qc', after.id,
            );
        }

        await runInstallationAutomation(c, { before, after, actor, input: data });

        const { rows: refetched } = await c.query(
            `SELECT * FROM installation_records WHERE id = $1`,
            [after.id],
        );
        return refetched[0];
    });
}

/**
 * Dedicated Ready-to-Deliver endpoint. Sets ready_to_deliver='Yes',
 * delivery_method, and timestamp atomically; runInstallationAutomation
 * handles SLA-tracker clear + notification emission.
 */
async function markReadyToDeliver(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM installation_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`installation_records ${id} not found`);
        }
        const before = lockRows[0];

        if (before.ready_to_deliver === 'Yes'
            && before.admin_log_response_status !== 'pending') {
            throw new ConflictError(
                `Installation ${id} Ready-to-Deliver already `
                + `${before.admin_log_response_status}`,
            );
        }
        if (!input.delivery_method) {
            throw new BadRequestError('delivery_method is required when marking Ready-to-Deliver');
        }

        const { rows } = await c.query(
            `UPDATE installation_records SET
                ready_to_deliver          = 'Yes',
                delivery_method           = $2,
                ready_to_deliver_at       = now(),
                admin_log_response_status = 'pending',
                workflow_phase            = CASE
                    WHEN workflow_phase IN ('pre_installation','workshop')
                        THEN 'ready_to_deliver'
                    ELSE workflow_phase
                END,
                updated_by                = $3,
                updated_at                = now()
              WHERE id = $1
              RETURNING *`,
            [id, input.delivery_method, actor.id],
        );
        const after = rows[0];

        await runInstallationAutomation(c, { before, after, actor, input });

        const { rows: refetched } = await c.query(
            `SELECT * FROM installation_records WHERE id = $1`,
            [after.id],
        );
        return refetched[0];
    });
}

async function deleteInstallation(id, actor) {
    const existing = await requireRow('installation_records', id);
    if (existing.workflow_phase === 'completed'
        || existing.ready_to_deliver === 'Yes'
        || existing.installation_start_date) {
        throw new ConflictError(
            `Installation ${id} has progressed past draft; cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE installation_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// PM (PREVENTIVE MAINTENANCE)
// ============================================================================

async function listPm({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_status) {
        extraFilters.push({ sql: 'workflow_status = $X', value: query.workflow_status });
    }
    if (query.related_job_order_id) {
        extraFilters.push({ sql: 'related_job_order_id = $X', value: query.related_job_order_id });
    }
    return listRows({
        table: 'pm_records',
        search: query.search,
        searchColumn: 'related_job_order_id',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getPm(id) {
    return requireRow('pm_records', id);
}

async function createPm(data, actor) {
    return db.withTransaction(async (c) => {
        const jobOrder = await requireRow('technical_job_orders', data.related_job_order_id, c);

        const { rows } = await c.query(
            `INSERT INTO pm_records
               (related_job_order_id, related_po_id,
                assigned_engineer_id, pm_schedule_date, pm_start_date, pm_end_date,
                work_duration_start, work_duration_end, pm_activity_notes,
                notes, workflow_status, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     COALESCE($11,'scheduled'),$12,$12)
             RETURNING *`,
            [
                data.related_job_order_id, data.related_po_id || jobOrder.related_po_id,
                data.assigned_engineer_id,
                data.pm_schedule_date, data.pm_start_date, data.pm_end_date,
                data.work_duration_start, data.work_duration_end, data.pm_activity_notes,
                data.notes, data.workflow_status, actor.id,
            ],
        );
        const pm = rows[0];

        if (data.service_report_file_ids && data.service_report_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.service_report_file_ids, 'technical.pm_service_report', pm.id,
            );
        }

        await runPmAutomation(c, { pmRow: pm, actor, input: data });
        return pm;
    });
}

/**
 * PM BASTP upload handler. Identical handoff contract as installation BAST:
 * materializes a bast_records row, creates an Invoice Customer draft,
 * advances the master PO to BAST, emits notifications. Idempotent on
 * workflow_status='completed' so repeated saves with bastp_file_ids
 * do not create duplicate BAST rows.
 */
async function runPmAutomation(client, { pmRow, actor, input }) {
    const bastpIds = Array.isArray(input && input.bastp_file_ids)
        ? input.bastp_file_ids
        : [];
    if (bastpIds.length === 0 || !pmRow.related_po_id) return { bast: false };
    if (pmRow.workflow_status === 'completed') return { bast: false };

    const poCustomer = await resolvePoCustomer(client, pmRow.related_po_id);

    // Persist a real bast_records row (job_type='PM') so invoice_customers
    // .related_bast_id FK is satisfied and the BASTP file attachments land
    // on a canonical BAST entity.
    const bastRow = await createBastRecordForHandoff(client, {
        jobType: 'PM',
        relatedJobOrderId: pmRow.related_job_order_id,
        relatedPoId: pmRow.related_po_id,
        customerId: poCustomer ? poCustomer.customer_id : null,
        attachmentIds: bastpIds,
        scopeSummary: `Auto-generated from PM ${pmRow.id} BASTP upload`,
        actor,
    });

    await financeService.createInvoiceCustomerDraftFromBast(client, {
        bastRow,
        deliveryOrderRow: null,
        masterPoId: pmRow.related_po_id,
        poCustomerId: poCustomer ? poCustomer.id : null,
        customerId: poCustomer ? poCustomer.customer_id : null,
        actor,
    });

    await poService.advanceStatus(client, {
        poId: pmRow.related_po_id,
        newStatus: 'BAST',
        actorUserId: actor.id,
        actorRole: actor.role,
        note: `BAST ${bastRow.bast_record_number} uploaded via pm_record ${pmRow.id}`,
        extraRoles: ['finance', 'superadmin', 'ceo'],
    });

    await notificationService.emit(client, {
        templateKey: 'technical.bast.submitted',
        title: `BAST ${bastRow.bast_record_number} submitted — PM ${pmRow.id}`,
        message: 'PM completion doc uploaded; Finance invoice draft created.',
        module: 'technical',
        entityType: 'bast_records',
        entityId: bastRow.id,
        senderUserId: actor.id,
        extraRoles: ['finance', 'superadmin', 'ceo'],
    });

    await client.query(
        `UPDATE pm_records
            SET workflow_status = 'completed',
                updated_by      = $1,
                updated_at      = now()
          WHERE id = $2`,
        [actor.id, pmRow.id],
    );
    return { bast: true };
}

async function updatePm(id, data, actor) {
    return db.withTransaction(async (c) => {
        const existing = await requireRow('pm_records', id, c);
        if (existing.workflow_status === 'completed') {
            throw new ConflictError(`PM record ${id} is completed; cannot edit`);
        }

        const { rows } = await c.query(
            `UPDATE pm_records SET
                related_po_id        = COALESCE($2, related_po_id),
                assigned_engineer_id = COALESCE($3, assigned_engineer_id),
                pm_schedule_date     = COALESCE($4, pm_schedule_date),
                pm_start_date        = COALESCE($5, pm_start_date),
                pm_end_date          = COALESCE($6, pm_end_date),
                work_duration_start  = COALESCE($7, work_duration_start),
                work_duration_end    = COALESCE($8, work_duration_end),
                pm_activity_notes    = COALESCE($9, pm_activity_notes),
                notes                = COALESCE($10, notes),
                workflow_status      = COALESCE($11, workflow_status),
                updated_by           = $12,
                updated_at           = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_po_id, data.assigned_engineer_id,
                data.pm_schedule_date, data.pm_start_date, data.pm_end_date,
                data.work_duration_start, data.work_duration_end, data.pm_activity_notes,
                data.notes, data.workflow_status, actor.id,
            ],
        );
        const pm = rows[0];

        if (data.service_report_file_ids && data.service_report_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.service_report_file_ids, 'technical.pm_service_report', pm.id,
            );
        }

        await runPmAutomation(c, { pmRow: pm, actor, input: data });

        const { rows: refetched } = await c.query(
            `SELECT * FROM pm_records WHERE id = $1`,
            [pm.id],
        );
        return refetched[0];
    });
}

async function deletePm(id, actor) {
    const existing = await requireRow('pm_records', id);
    if (existing.workflow_status === 'completed') {
        throw new ConflictError(`Completed PM record ${id} cannot be deleted`);
    }
    await db.query(
        `UPDATE pm_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// SPAREPART
// ============================================================================

async function listSparepart({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_status) {
        extraFilters.push({ sql: 'workflow_status = $X', value: query.workflow_status });
    }
    if (query.admin_log_response_status) {
        extraFilters.push({
            sql: 'admin_log_response_status = $X',
            value: query.admin_log_response_status,
        });
    }
    if (query.related_job_order_id) {
        extraFilters.push({ sql: 'related_job_order_id = $X', value: query.related_job_order_id });
    }
    return listRows({
        table: 'sparepart_records',
        search: query.search,
        searchColumn: 'related_job_order_id',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getSparepart(id) {
    return requireRow('sparepart_records', id);
}

/**
 * Sparepart RTD trigger mirrors Installation exactly: the 2-working-day
 * Admin & Log response SLA is shared between both record types, driven by
 * the same sla_ready_to_deliver_monitor background job (scanning both
 * installation_records and sparepart_records in a later phase).
 *
 * Billing handoff trigger (billing_support_file_ids) emits a notification
 * to Finance but does NOT advance the PO — PM/Installation BAST flows own
 * the BAST→Invoice transition.
 */
async function runSparepartAutomation(client, { before, after, actor, input }) {
    const justBecameTrue = (field, truthy) =>
        after[field] === truthy && (!before || before[field] !== truthy);

    const events = { rtd: false, billing: false };

    if (justBecameTrue('ready_to_deliver', 'Yes')) {
        await client.query(
            `UPDATE sparepart_records
                SET ready_to_deliver_at       = COALESCE(ready_to_deliver_at, now()),
                    admin_log_response_status = 'pending',
                    workflow_status           = 'ready',
                    updated_by                = $1,
                    updated_at                = now()
              WHERE id = $2`,
            [actor.id, after.id],
        );

        await client.query(
            `UPDATE sla_tracking
                SET overdue_at         = NULL,
                    escalation_sent_at = NULL
              WHERE entity_type = 'sparepart_records.ready_to_deliver'
                AND entity_id   = $1`,
            [after.id],
        );

        await notificationService.emit(client, {
            templateKey: 'technical.installation.ready_to_deliver',
            title: `Sparepart ${after.id} Ready to Deliver`,
            message: `Sparepart is ready for ${after.delivery_method || 'delivery'}.`,
            module: 'technical',
            entityType: 'sparepart_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['admin_log', 'superadmin', 'ceo'],
        });
        events.rtd = true;
    }

    const billingIds = Array.isArray(input && input.billing_support_file_ids)
        ? input.billing_support_file_ids
        : [];
    if (billingIds.length > 0) {
        await attachFilesToEntity(
            client, billingIds, 'technical.sparepart_billing', after.id,
        );

        await notificationService.emit(client, {
            templateKey: 'technical.billing.handoff',
            title: `Sparepart billing handoff — ${after.id}`,
            message: 'Sparepart billing documents handed off to Finance.',
            module: 'technical',
            entityType: 'sparepart_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });
        events.billing = true;
    }

    return events;
}

async function createSparepart(data, actor) {
    return db.withTransaction(async (c) => {
        const jobOrder = await requireRow('technical_job_orders', data.related_job_order_id, c);

        const { rows } = await c.query(
            `INSERT INTO sparepart_records
               (related_job_order_id, related_po_id, related_awb_id,
                workshop_check_status, ready_to_deliver, delivery_method,
                admin_log_response_status, ready_to_deliver_at,
                notes, workflow_status, created_by, updated_by)
             VALUES ($1,$2,$3, COALESCE($4,'Pending'),$5,$6,
                     COALESCE($7,'pending'),$8,$9,
                     COALESCE($10,'awaiting_awb'),$11,$11)
             RETURNING *`,
            [
                data.related_job_order_id, data.related_po_id || jobOrder.related_po_id,
                data.related_awb_id,
                data.workshop_check_status, data.ready_to_deliver, data.delivery_method,
                data.admin_log_response_status, data.ready_to_deliver_at,
                data.notes, data.workflow_status, actor.id,
            ],
        );
        const sp = rows[0];

        await runSparepartAutomation(c, {
            before: null, after: sp, actor, input: data,
        });

        const { rows: refetched } = await c.query(
            `SELECT * FROM sparepart_records WHERE id = $1`,
            [sp.id],
        );
        return refetched[0];
    });
}

async function updateSparepart(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM sparepart_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`sparepart_records ${id} not found`);
        }
        const before = lockRows[0];
        if (before.workflow_status === 'dispatched') {
            throw new ConflictError(`Sparepart ${id} already dispatched; cannot edit`);
        }

        const { rows } = await c.query(
            `UPDATE sparepart_records SET
                related_po_id         = COALESCE($2, related_po_id),
                related_awb_id        = COALESCE($3, related_awb_id),
                workshop_check_status = COALESCE($4, workshop_check_status),
                ready_to_deliver      = COALESCE($5, ready_to_deliver),
                delivery_method       = COALESCE($6, delivery_method),
                notes                 = COALESCE($7, notes),
                workflow_status       = COALESCE($8, workflow_status),
                updated_by            = $9,
                updated_at            = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_po_id, data.related_awb_id,
                data.workshop_check_status, data.ready_to_deliver, data.delivery_method,
                data.notes, data.workflow_status, actor.id,
            ],
        );
        const after = rows[0];

        await runSparepartAutomation(c, { before, after, actor, input: data });

        const { rows: refetched } = await c.query(
            `SELECT * FROM sparepart_records WHERE id = $1`,
            [after.id],
        );
        return refetched[0];
    });
}

async function deleteSparepart(id, actor) {
    const existing = await requireRow('sparepart_records', id);
    if (existing.workflow_status === 'dispatched'
        || existing.ready_to_deliver === 'Yes') {
        throw new ConflictError(
            `Sparepart ${id} has progressed past draft; cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE sparepart_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// INSPECTION & QC
// ============================================================================

async function listQc({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.review_status) {
        extraFilters.push({ sql: 'review_status = $X', value: query.review_status });
    }
    if (query.final_submit_status) {
        extraFilters.push({ sql: 'final_submit_status = $X', value: query.final_submit_status });
    }
    if (query.qc_result) {
        extraFilters.push({ sql: 'qc_result = $X', value: query.qc_result });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    return listRows({
        table: 'inspection_qc_records',
        search: query.search,
        searchColumn: 'qc_record_number',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getQc(id) {
    return requireRow('inspection_qc_records', id);
}

async function createQc(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'inspection_qc_records', 'qc_record_number', TECHNICAL_PREFIXES.QC,
        );
        const { rows } = await c.query(
            `INSERT INTO inspection_qc_records
               (qc_record_number, related_job_order_id, related_po_id,
                item_or_equipment_name, item_condition,
                defect_category, defect_description,
                pic_user_id, qc_result,
                review_status, final_submit_status, notes,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,
                     COALESCE($6,'None'),$7,$8,$9,
                     COALESCE($10,'Pending Review'), COALESCE($11,'Draft'),$12,$13,$13)
             RETURNING *`,
            [
                recordNumber, data.related_job_order_id, data.related_po_id,
                data.item_or_equipment_name, data.item_condition,
                data.defect_category, data.defect_description,
                data.pic_user_id, data.qc_result,
                data.review_status, data.final_submit_status, data.notes, actor.id,
            ],
        );
        const qc = rows[0];

        if (data.attachment_qc_file_ids && data.attachment_qc_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_qc_file_ids, 'technical.inspection_qc', qc.id,
            );
        }
        return qc;
    });
}

async function updateQc(id, data, actor) {
    const existing = await requireRow('inspection_qc_records', id);
    if (existing.final_submit_status === 'Submitted') {
        throw new ConflictError(
            `QC ${existing.qc_record_number} already Submitted; cannot edit`,
        );
    }
    const { rows } = await db.query(
        `UPDATE inspection_qc_records SET
            related_job_order_id   = COALESCE($2, related_job_order_id),
            related_po_id          = COALESCE($3, related_po_id),
            item_or_equipment_name = COALESCE($4, item_or_equipment_name),
            item_condition         = COALESCE($5, item_condition),
            defect_category        = COALESCE($6, defect_category),
            defect_description     = COALESCE($7, defect_description),
            pic_user_id            = COALESCE($8, pic_user_id),
            qc_result              = COALESCE($9, qc_result),
            notes                  = COALESCE($10, notes),
            updated_by             = $11,
            updated_at             = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.related_job_order_id, data.related_po_id,
            data.item_or_equipment_name, data.item_condition,
            data.defect_category, data.defect_description,
            data.pic_user_id, data.qc_result, data.notes, actor.id,
        ],
    );
    return rows[0];
}

/**
 * Review + final submit endpoint. When the incoming state transitions to
 * review_status='Approved' AND final_submit_status='Submitted', advances
 * the master PO to Inspected (STATUS_TEMPLATE.Inspected =
 * technical.po.inspected) and emits technical.qc.completed in parallel.
 *
 * Forward-only on review_status: Pending Review → Reviewed → Approved.
 */
async function submitQcReview(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM inspection_qc_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`inspection_qc_records ${id} not found`);
        }
        const before = lockRows[0];

        const reviewOrder = { 'Pending Review': 0, 'Reviewed': 1, 'Approved': 2 };
        if (input.review_status
            && reviewOrder[input.review_status] < reviewOrder[before.review_status]) {
            throw new ConflictError(
                `Cannot move QC review '${before.review_status}' → '${input.review_status}'`,
            );
        }
        if (before.final_submit_status === 'Submitted') {
            throw new ConflictError('QC already Submitted; cannot resubmit');
        }

        const { rows } = await c.query(
            `UPDATE inspection_qc_records SET
                review_status       = COALESCE($2, review_status),
                final_submit_status = COALESCE($3, final_submit_status),
                notes               = COALESCE($4, notes),
                updated_by          = $5,
                updated_at          = now()
              WHERE id = $1
              RETURNING *`,
            [
                id, input.review_status, input.final_submit_status,
                input.note || null, actor.id,
            ],
        );
        const qc = rows[0];

        const shouldAdvancePo = qc.review_status === 'Approved'
            && qc.final_submit_status === 'Submitted'
            && qc.related_po_id
            && !(before.review_status === 'Approved'
                 && before.final_submit_status === 'Submitted');

        let masterPo = null;
        if (shouldAdvancePo) {
            masterPo = await poService.advanceStatus(c, {
                poId: qc.related_po_id,
                newStatus: 'Inspected',
                actorUserId: actor.id,
                actorRole: actor.role,
                note: `QC ${qc.qc_record_number} Approved + Submitted`,
                extraRoles: ['admin_log', 'finance', 'superadmin', 'ceo'],
            });

            await notificationService.emit(c, {
                templateKey: 'technical.qc.completed',
                title: `QC ${qc.qc_record_number} completed`,
                message: `QC ${qc.qc_record_number} approved and submitted; PO advanced to Inspected.`,
                module: 'technical',
                entityType: 'inspection_qc_records',
                entityId: qc.id,
                senderUserId: actor.id,
                extraRoles: ['technical', 'superadmin', 'ceo'],
            });
        }

        return { inspection_qc: qc, purchase_order: masterPo };
    });
}

async function deleteQc(id, actor) {
    const existing = await requireRow('inspection_qc_records', id);
    if (existing.final_submit_status === 'Submitted') {
        throw new ConflictError(
            `Submitted QC ${existing.qc_record_number} cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE inspection_qc_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// BAST (Berita Acara Serah Terima)
// ============================================================================

async function listBast({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_status) {
        extraFilters.push({ sql: 'workflow_status = $X', value: query.workflow_status });
    }
    if (query.job_type) {
        extraFilters.push({ sql: 'job_type = $X', value: query.job_type });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    return listRows({
        table: 'bast_records',
        search: query.search,
        searchColumn: 'bast_record_number',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getBast(id) {
    return requireRow('bast_records', id);
}

async function createBast(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'bast_records', 'bast_record_number', TECHNICAL_PREFIXES.BAST,
        );

        const { rows } = await c.query(
            `INSERT INTO bast_records
               (bast_record_number, related_job_order_id, related_po_id,
                customer_id, job_type,
                completion_start_date, completion_end_date, scope_summary,
                commissioning_included, training_included,
                customer_pic, technical_pic_id,
                notes, workflow_status, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                     COALESCE($14,'draft'),$15,$15)
             RETURNING *`,
            [
                recordNumber, data.related_job_order_id, data.related_po_id,
                data.customer_id, data.job_type,
                data.completion_start_date, data.completion_end_date, data.scope_summary,
                data.commissioning_included, data.training_included,
                data.customer_pic, data.technical_pic_id,
                data.notes, data.workflow_status, actor.id,
            ],
        );
        const bast = rows[0];

        if (data.attachment_bast_file_ids && data.attachment_bast_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_bast_file_ids, 'technical.bast', bast.id,
            );
        }
        if (data.attachment_service_report_file_ids
            && data.attachment_service_report_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_service_report_file_ids,
                'technical.bast_service_report', bast.id,
            );
        }
        if (data.attachment_test_result_file_ids
            && data.attachment_test_result_file_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_test_result_file_ids,
                'technical.bast_test_result', bast.id,
            );
        }

        return bast;
    });
}

async function updateBast(id, data, actor) {
    const existing = await requireRow('bast_records', id);
    if (existing.workflow_status === 'sent_to_finance') {
        throw new ConflictError(
            `BAST ${existing.bast_record_number} already sent to Finance; cannot edit`,
        );
    }
    const { rows } = await db.query(
        `UPDATE bast_records SET
            related_job_order_id   = COALESCE($2, related_job_order_id),
            related_po_id          = COALESCE($3, related_po_id),
            customer_id            = COALESCE($4, customer_id),
            job_type               = COALESCE($5, job_type),
            completion_start_date  = COALESCE($6, completion_start_date),
            completion_end_date    = COALESCE($7, completion_end_date),
            scope_summary          = COALESCE($8, scope_summary),
            commissioning_included = COALESCE($9, commissioning_included),
            training_included      = COALESCE($10, training_included),
            customer_pic           = COALESCE($11, customer_pic),
            technical_pic_id       = COALESCE($12, technical_pic_id),
            notes                  = COALESCE($13, notes),
            workflow_status        = COALESCE($14, workflow_status),
            updated_by             = $15,
            updated_at             = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.related_job_order_id, data.related_po_id, data.customer_id,
            data.job_type, data.completion_start_date, data.completion_end_date,
            data.scope_summary, data.commissioning_included, data.training_included,
            data.customer_pic, data.technical_pic_id,
            data.notes, data.workflow_status, actor.id,
        ],
    );
    return rows[0];
}

/**
 * Send BAST to Finance. Core Technical → Finance handoff:
 *   1. Bind any attachment IDs (new or previously-uploaded).
 *   2. Flip BAST: workflow_status='sent_to_finance', sent_to_finance=true,
 *      sent_to_finance_at=now().
 *   3. Create Invoice Customer draft via financeService hook (draft is
 *      registered at invoice_status='Registered'; finance.invoice_customer
 *      .registered is emitted by the finance hook itself).
 *   4. Advance master PO → BAST (STATUS_TEMPLATE.BAST = technical.po.bast).
 *   5. Emit technical.bast.submitted on top of the finance-side emission.
 */
async function sendBastToFinance(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM bast_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`bast_records ${id} not found`);
        const bast = lockRows[0];

        if (bast.workflow_status === 'sent_to_finance' || bast.sent_to_finance) {
            throw new ConflictError(
                `BAST ${bast.bast_record_number} already sent to Finance`,
            );
        }
        if (!bast.related_po_id) {
            throw new BadRequestError(
                `BAST ${bast.bast_record_number} has no related master PO`,
            );
        }

        if (input.attachment_ids && input.attachment_ids.length > 0) {
            await attachFilesToEntity(c, input.attachment_ids, 'technical.bast', bast.id);
        }

        const { rows: upd } = await c.query(
            `UPDATE bast_records SET
                workflow_status    = 'sent_to_finance',
                sent_to_finance    = true,
                sent_to_finance_at = now(),
                updated_by         = $2,
                updated_at         = now()
              WHERE id = $1
              RETURNING *`,
            [id, actor.id],
        );
        const updated = upd[0];

        const poCustomer = await resolvePoCustomer(c, updated.related_po_id);

        const invoiceDraft = await financeService.createInvoiceCustomerDraftFromBast(c, {
            bastRow: updated,
            deliveryOrderRow: null,
            masterPoId: updated.related_po_id,
            poCustomerId: poCustomer ? poCustomer.id : null,
            customerId: updated.customer_id
                || (poCustomer ? poCustomer.customer_id : null),
            actor,
        });

        const masterPo = await poService.advanceStatus(c, {
            poId: updated.related_po_id,
            newStatus: 'BAST',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: input.note
                || `BAST ${updated.bast_record_number} submitted to Finance`,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });

        await notificationService.emit(c, {
            templateKey: 'technical.bast.submitted',
            title: `BAST ${updated.bast_record_number} sent to Finance`,
            message: input.note
                || `BAST ${updated.bast_record_number} handed off; Finance invoice draft created.`,
            module: 'technical',
            entityType: 'bast_records',
            entityId: updated.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });

        return { bast: updated, invoiceDraft, masterPo };
    });
}

async function deleteBast(id, actor) {
    const existing = await requireRow('bast_records', id);
    if (existing.workflow_status === 'sent_to_finance' || existing.sent_to_finance) {
        throw new ConflictError(
            `BAST ${existing.bast_record_number} already sent; cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE bast_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

module.exports = {
    // Job Order
    listJobOrders, getJobOrder, createJobOrder, updateJobOrder, deleteJobOrder,
    // Installation
    listInstallations, getInstallation, createInstallation, updateInstallation,
    markReadyToDeliver, deleteInstallation,
    // PM
    listPm, getPm, createPm, updatePm, deletePm,
    // Sparepart
    listSparepart, getSparepart, createSparepart, updateSparepart, deleteSparepart,
    // QC
    listQc, getQc, createQc, updateQc, submitQcReview, deleteQc,
    // BAST
    listBast, getBast, createBast, updateBast, sendBastToFinance, deleteBast,
    // test hooks
    runInstallationAutomation, runPmAutomation, runSparepartAutomation,
};

'use strict';

const db = require('../config/database');
const notificationService = require('./notification.service');
const ws = require('../websocket');
const { addWorkingDays } = require('../utils/workingDays');
const {
    NotFoundError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    ValidationError,
} = require('../utils/errors');

// Master Purchase-Order lifecycle state machine. Every stage transition
// MUST go through advanceStatus() so that the four invariants from CLAUDE.md
// are honored atomically inside a single transaction:
//
//   1. insert purchase_order_status_history
//   2. insert purchase_order_tracking_events
//   3. fire the matching notification template
//   4. update purchase_orders.current_status (+ updated_by bookkeeping)
//
// The Sales module is the entry point: creating a Sales PO calls
// initializeFromSales() which constructs the purchase_orders row at status
// 'Registered' and seeds the first history + tracking event. Downstream
// transitions (Processed by Sales, Production by Finance, Shipped/Customs/
// Arrived/Delivery by Admin & Log, Inspected/Installation/BAST by Technical,
// Invoice by Finance) all call advanceStatus().

// Canonical 11-stage order (index = position in lifecycle).
const STATUS_ORDER = Object.freeze([
    'Registered', 'Processed', 'Production', 'Shipped', 'Customs', 'Arrived',
    'Inspected', 'Delivery', 'Installation', 'BAST', 'Invoice',
]);

// Per-type lifecycle paths (Sub-2-lite). Each is an ordered SUBSEQUENCE of
// STATUS_ORDER, so forward-only motion is preserved. Unknown/installation =
// the full path → legacy behavior unchanged.
const PATH_BY_TYPE = Object.freeze({
    service: ['Registered', 'Processed', 'Inspected', 'BAST', 'Invoice'],
    supply: ['Registered', 'Processed', 'Production', 'Shipped', 'Customs',
        'Arrived', 'Inspected', 'Delivery', 'Invoice'],
    installation: STATUS_ORDER,
});

function pathFor(poType) {
    return PATH_BY_TYPE[poType] || STATUS_ORDER;
}

// Throws if newStatus is not on poType's path, or is a backward move.
// Pure (no I/O) so it is unit-testable; advanceStatus delegates to it.
function assertOnPath(poType, currentStatus, newStatus) {
    const path = pathFor(poType);
    if (!path.includes(newStatus)) {
        throw new BadRequestError(
            `Status '${newStatus}' is not on the ${poType || 'installation'} path`,
        );
    }
    if (path.indexOf(newStatus) < path.indexOf(currentStatus)) {
        throw new BadRequestError(
            `Cannot move PO back to '${newStatus}' from '${currentStatus}'`,
        );
    }
}

const STATUS_CODE = Object.freeze({
    Registered:   'REGISTERED',
    Processed:    'PROCESSED',
    Production:   'PRODUCTION',
    Shipped:      'SHIPPED',
    Customs:      'CUSTOMS',
    Arrived:      'ARRIVED',
    Inspected:    'INSPECTED',
    Delivery:     'DELIVERY',
    Installation: 'INSTALLATION',
    BAST:         'BAST',
    Invoice:      'INVOICE',
});

// template_key for rejection + admin-override transitions. Seeded alongside
// the stage-advance templates in scripts/seed.js.
const REJECT_TEMPLATE   = 'po.stage_rejected';
const OVERRIDE_TEMPLATE = 'po.stage_admin_overridden';

// template_key per status → keep aligned with Seed 6 default notification
// templates. If a template row does not exist the NotificationService falls
// back to dashboard-only delivery.
const STATUS_TEMPLATE = Object.freeze({
    Registered:   'sales.po.registered',
    Processed:    'sales.po.processed',
    Production:   'finance.po.production',
    Shipped:      'admin_log.po.shipped',
    Customs:      'admin_log.po.customs',
    Arrived:      'admin_log.po.arrived',
    Inspected:    'technical.po.inspected',
    Delivery:     'admin_log.po.delivery',
    Installation: 'technical.po.installation',
    BAST:         'technical.po.bast',
    Invoice:      'finance.po.invoice',
});

// Default additional roles to notify at every stage transition; the
// notification_templates.recipient_roles_json column overrides this per
// trigger_event. These defaults are the fallback used when a template row
// is absent.
//
// Recipients for Finance-owned stages follow MOD_finance [FINANCE NOTIFICATION
// EVENTS]:
//   Production → finance.po.production : Technical, Admin & Log, Superadmin, CEO
//   Invoice    → finance.po.invoice    : Superadmin, CEO, Sales, Admin & Log
//
// Sales-owned stages follow MOD_sales:
//   Registered → sales.po.registered   : Sales (confirmation), Admin & Log, Finance
//   Processed  → sales.po.processed    : Admin & Log, Finance
const STATUS_DEFAULT_RECIPIENTS = Object.freeze({
    Registered:   ['sales', 'admin_log', 'finance'],
    Processed:    ['admin_log', 'finance'],
    Production:   ['technical', 'admin_log', 'superadmin', 'ceo'],
    Shipped:      ['sales', 'admin_log', 'technical'],
    Customs:      ['sales', 'admin_log'],
    Arrived:      ['sales', 'admin_log', 'technical'],
    Inspected:    ['sales', 'technical', 'admin_log'],
    Delivery:     ['sales', 'admin_log', 'technical'],
    Installation: ['sales', 'technical'],
    BAST:         ['sales', 'technical', 'finance'],
    Invoice:      ['superadmin', 'ceo', 'sales', 'admin_log'],
});

function isValidStatus(status) {
    return STATUS_ORDER.includes(status);
}

function statusIndex(status) {
    return STATUS_ORDER.indexOf(status);
}

// Map master PO status → po_customer_records.workflow_status. Values follow
// MOD_finance §FORM 1: registered / active / invoiced / completed. 'completed'
// is a Finance-owned state set separately (after payment), not derived here.
function poCustomerWorkflowFor(masterStatus) {
    if (masterStatus === 'Registered' || masterStatus === 'Processed') return 'registered';
    if (masterStatus === 'Invoice') return 'invoiced';
    return 'active';
}

// Keep po_customer_records.current_po_status + workflow_status in lock-step
// with the master PO. Called from advanceStatus and initializeFromSales.
// Kept inline (rather than delegating to finance.service) to avoid a circular
// require between po.service and finance.service.
async function syncPoCustomerMirror(client, masterPoId, newStatus) {
    await client.query(
        `UPDATE po_customer_records
            SET current_po_status = $1,
                workflow_status   = $2,
                updated_at        = now()
          WHERE related_po_id = $3 AND deleted_at IS NULL`,
        [newStatus, poCustomerWorkflowFor(newStatus), masterPoId],
    );
}

async function getById(poId, runner = db) {
    const { rows } = await runner.query(
        `SELECT * FROM purchase_orders WHERE id = $1 AND deleted_at IS NULL`,
        [poId],
    );
    return rows[0] || null;
}

async function getByPoNumber(poNumber, runner = db) {
    const { rows } = await runner.query(
        `SELECT * FROM purchase_orders WHERE po_number = $1 AND deleted_at IS NULL`,
        [poNumber],
    );
    return rows[0] || null;
}

// ---------------------------------------------------------------------------
// _writeStageTransition — private helper that enforces the 4-part PO
// invariant for every kind of stage change (advance, reject, override).
//
//   kind='advance'  — forward-only motion; uses STATUS_TEMPLATE[newStatus]
//   kind='reject'   — backward corrective; history.is_rejection=true;
//                      uses REJECT_TEMPLATE; notifies superadmin+ceo+actor role
//   kind='override' — arbitrary skip; history.is_admin_override=true;
//                      uses OVERRIDE_TEMPLATE; notifies superadmin+ceo
//
// The caller is responsible for locking the PO row and validating
// directional constraints before calling this helper.
//
// Side-effects (all within the supplied client transaction):
//   1. UPDATE purchase_orders.current_status + bookkeeping columns
//   2. INSERT purchase_order_status_history
//   3. INSERT purchase_order_tracking_events
//   4. syncPoCustomerMirror (keeps po_customer_records in step)
//   5. notificationService.emit
//   6. setImmediate WS push (po:status_update)
// ---------------------------------------------------------------------------
async function _writeStageTransition(client, {
    poId, poNumber, previousStatus, newStatus, actor,
    note = null, reasonIfDelayed = null, attachmentUrl = null,
    kind = 'advance',
    rejectCountAfter = null,
    extraRoles = [],
}) {
    // 1. Update master PO row.
    const updated = await client.query(
        `UPDATE purchase_orders
            SET current_status     = $1,
                updated_by_user_id = $2,
                updated_by_role    = $3,
                updated_at         = now()
          WHERE id = $4
          RETURNING *`,
        [newStatus, actor.id, actor.role, poId],
    );
    const updatedRow = updated.rows[0];

    // 2. Insert status history — flags differ by kind.
    const isRejection     = kind === 'reject';
    const isAdminOverride = kind === 'override';
    await client.query(
        `INSERT INTO purchase_order_status_history
           (po_id, po_number, status_code, status_label,
            updated_by_user_id, updated_by_role, note, reason_if_delayed,
            attachment_url, is_rejection, reject_count_after, is_admin_override)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            poId, poNumber, STATUS_CODE[newStatus], newStatus,
            actor.id, actor.role, note, reasonIfDelayed,
            attachmentUrl, isRejection,
            isRejection ? rejectCountAfter : null,
            isAdminOverride,
        ],
    );

    // 3. Insert tracking event.
    await client.query(
        `INSERT INTO purchase_order_tracking_events
           (po_id, event_type, payload_json)
         VALUES ($1, $2, $3::jsonb)`,
        [
            poId,
            kind === 'advance' ? 'po.status_advanced'
                : kind === 'reject' ? 'po.stage_rejected'
                    : 'po.stage_admin_overridden',
            JSON.stringify({
                from: previousStatus,
                to: newStatus,
                actor_user_id: actor.id,
                actor_role: actor.role,
                note,
                reason_if_delayed: reasonIfDelayed,
                kind,
            }),
        ],
    );

    // 4. Keep Finance-side PO Customer mirror in step before notification
    //    so downstream readers see consistent state.
    await syncPoCustomerMirror(client, poId, newStatus);

    // 5. Emit notification (template selection + recipient set by kind).
    let templateKey;
    let defaultRecipients;
    if (kind === 'advance') {
        templateKey      = STATUS_TEMPLATE[newStatus];
        defaultRecipients = STATUS_DEFAULT_RECIPIENTS[newStatus] || [];
    } else if (kind === 'reject') {
        templateKey      = REJECT_TEMPLATE;
        // Notify superadmin, ceo, and the role that last advanced the PO
        // (actor.role at this point is the rejecting role, which is appropriate
        // for the "inform the stage owner" pattern).
        defaultRecipients = ['superadmin', 'ceo', actor.role];
    } else {
        templateKey      = OVERRIDE_TEMPLATE;
        defaultRecipients = ['superadmin', 'ceo'];
    }

    await notificationService.emit(client, {
        templateKey,
        title: kind === 'advance'
            ? `PO ${poNumber} → ${newStatus}`
            : kind === 'reject'
                ? `PO ${poNumber} stage rejected (→ ${newStatus})`
                : `PO ${poNumber} admin override → ${newStatus}`,
        message: note || (
            kind === 'advance'
                ? `Purchase order ${poNumber} advanced to ${newStatus}.`
                : kind === 'reject'
                    ? `Purchase order ${poNumber} rejected back to ${newStatus}.`
                    : `Purchase order ${poNumber} overridden to ${newStatus} by admin.`
        ),
        module: 'po-tracking',
        entityType: 'purchase_orders',
        entityId: poId,
        senderUserId: actor.id,
        extraRoles: [...new Set([...defaultRecipients, ...extraRoles])],
    });

    // 6. Realtime WS push — fire-and-forget via setImmediate so the outer
    //    transaction can commit before the frontend refetches.
    const broadcastRoles = new Set([
        ...defaultRecipients,
        ...extraRoles,
        'superadmin', 'ceo',
    ]);
    setImmediate(() => {
        const payload = {
            po_id:           poId,
            po_number:       poNumber,
            new_status:      newStatus,
            previous_status: previousStatus,
            kind,
            updated_by_role: actor.role,
            updated_at:      updatedRow.updated_at,
        };
        for (const role of broadcastRoles) {
            try {
                ws.sendToRole(role, 'po:status_update', payload);
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[po] po:status_update push failed', {
                    role, po_id: poId, kind, error: err.message,
                });
            }
        }
    });

    return updatedRow;
}

/**
 * Create the master purchase_orders row for a Sales PO submission.
 * Writes the initial Registered history + tracking event and fires the
 * sales.po.registered notification template.
 *
 * @param {import('pg').PoolClient} client        Transactional client (REQUIRED).
 * @param {object} params
 * @param {string} params.poNumber                Master PO number (unique).
 * @param {string} params.customerId              uuid or null.
 * @param {Date|string|null} params.dueAt         Master PO due_at (delivery_deadline).
 * @param {string} params.actorUserId
 * @param {string} params.actorRole
 * @param {string} [params.note]
 * @param {string} [params.attachmentUrl]
 * @returns {Promise<object>}                      The newly created purchase_orders row.
 */
async function initializeFromSales(client, params) {
    if (!client) throw new Error('po.initializeFromSales requires transactional client');
    const {
        poNumber, customerId, dueAt, actorUserId, actorRole,
        note = null, attachmentUrl = null,
    } = params;

    if (!poNumber) throw new BadRequestError('po_number is required to initialize a PO');

    // Uniqueness guard so a duplicate sales PO doesn't collide the master PO.
    const existing = await client.query(
        `SELECT id FROM purchase_orders WHERE po_number = $1`,
        [poNumber],
    );
    if (existing.rowCount > 0) {
        throw new ConflictError(`Purchase order with po_number '${poNumber}' already exists`);
    }

    const initialStatus = 'Registered';
    const insert = await client.query(
        `INSERT INTO purchase_orders
           (po_number, current_status, created_by_user_id, created_by_role,
            updated_by_user_id, updated_by_role, customer_id, due_at)
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6)
         RETURNING *`,
        [poNumber, initialStatus, actorUserId, actorRole, customerId, dueAt],
    );
    const po = insert.rows[0];

    await client.query(
        `INSERT INTO purchase_order_status_history
           (po_id, po_number, status_code, status_label,
            updated_by_user_id, updated_by_role, note, attachment_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [po.id, po.po_number, STATUS_CODE[initialStatus], initialStatus,
            actorUserId, actorRole, note, attachmentUrl],
    );

    await client.query(
        `INSERT INTO purchase_order_tracking_events
           (po_id, event_type, payload_json)
         VALUES ($1, $2, $3::jsonb)`,
        [po.id, 'po.created', JSON.stringify({
            status: initialStatus,
            actor_user_id: actorUserId,
            actor_role: actorRole,
            note,
        })],
    );

    await notificationService.emit(client, {
        templateKey: STATUS_TEMPLATE[initialStatus],
        title: `PO ${po.po_number} registered`,
        message: note || `Sales registered purchase order ${po.po_number}.`,
        module: 'po-tracking',
        entityType: 'purchase_orders',
        entityId: po.id,
        senderUserId: actorUserId,
        extraRoles: STATUS_DEFAULT_RECIPIENTS[initialStatus],
    });

    return po;
}

/**
 * Advance a PO to the next lifecycle status. Enforces forward-only motion
 * along STATUS_ORDER; returning to a prior stage is rejected (the user must
 * open a corrective workflow, not silently regress the state machine).
 *
 * Writes the four invariant side-effects in a single transaction.
 *
 * @param {import('pg').PoolClient|null} client   Optional transactional client.
 *        If null, a fresh transaction is opened.
 * @param {object} params
 * @param {string} params.poId
 * @param {string} params.newStatus
 * @param {string} params.actorUserId
 * @param {string} params.actorRole
 * @param {string} [params.note]
 * @param {string} [params.reasonIfDelayed]
 * @param {string} [params.attachmentUrl]
 * @param {string[]} [params.extraRoles]
 * @returns {Promise<object>}                      Updated purchase_orders row.
 */
async function advanceStatus(client, params) {
    const runTransactional = async (c) => {
        const {
            poId, newStatus, actorUserId, actorRole,
            note = null, reasonIfDelayed = null, attachmentUrl = null,
            extraRoles = [],
        } = params;

        if (!isValidStatus(newStatus)) {
            throw new BadRequestError(`Unknown PO status '${newStatus}'`);
        }
        const poRes = await c.query(
            `SELECT * FROM purchase_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [poId],
        );
        if (poRes.rowCount === 0) throw new NotFoundError(`Purchase order ${poId} not found`);
        const po = poRes.rows[0];

        if (po.current_status === newStatus) return po;
        assertOnPath(po.po_type, po.current_status, newStatus);

        return _writeStageTransition(c, {
            poId:           po.id,
            poNumber:       po.po_number,
            previousStatus: po.current_status,
            newStatus,
            actor:          { id: actorUserId, role: actorRole },
            note,
            reasonIfDelayed,
            attachmentUrl,
            kind:           'advance',
            extraRoles,
        });
    };

    if (client) return runTransactional(client);
    return db.withTransaction(runTransactional);
}

/**
 * Mark a Sales-stage PO as overdue. Sets overdue_at / overdue_reason /
 * escalation_sent_at and emits the sales.po.overdue template. If the caller
 * also supplies a reason (sales.po.delay_justified) pass
 * templateKey='sales.po.delay_justified' via options.
 */
async function flagOverdue(client, params) {
    const runTransactional = async (c) => {
        const {
            poId, reason = null, attachmentId = null,
            actorUserId, actorRole,
            templateKey = 'sales.po.overdue',
            title,
        } = params;

        const poRes = await c.query(
            `SELECT * FROM purchase_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [poId],
        );
        if (poRes.rowCount === 0) throw new NotFoundError(`Purchase order ${poId} not found`);
        const po = poRes.rows[0];

        const updated = await c.query(
            `UPDATE purchase_orders
                SET overdue_at            = COALESCE(overdue_at, now()),
                    overdue_reason        = COALESCE($1, overdue_reason),
                    overdue_attachment_id = COALESCE($2, overdue_attachment_id),
                    escalation_sent_at    = COALESCE(escalation_sent_at, now()),
                    updated_by_user_id    = $3,
                    updated_by_role       = $4,
                    updated_at            = now()
              WHERE id = $5
              RETURNING *`,
            [reason, attachmentId, actorUserId, actorRole, poId],
        );

        await c.query(
            `INSERT INTO purchase_order_tracking_events
               (po_id, event_type, payload_json)
             VALUES ($1, $2, $3::jsonb)`,
            [po.id, 'po.overdue_flagged', JSON.stringify({
                reason,
                attachment_id: attachmentId,
                actor_user_id: actorUserId,
                actor_role: actorRole,
                template_key: templateKey,
            })],
        );

        await notificationService.emit(c, {
            templateKey,
            title: title || `PO ${po.po_number} SLA breach`,
            message: reason || `Purchase order ${po.po_number} has breached its SLA deadline.`,
            module: 'po-tracking',
            entityType: 'purchase_orders',
            entityId: po.id,
            senderUserId: actorUserId,
            extraRoles: ['superadmin', 'ceo', 'admin_log', 'finance'],
        });

        return updated.rows[0];
    };
    if (client) return runTransactional(client);
    return db.withTransaction(runTransactional);
}

async function getHistory(poId) {
    const { rows } = await db.query(
        `SELECT id, po_id, po_number, status_code, status_label,
                updated_by_user_id, updated_by_role, note, reason_if_delayed,
                attachment_url, created_at
           FROM purchase_order_status_history
          WHERE po_id = $1
          ORDER BY created_at ASC`,
        [poId],
    );
    return rows;
}

/**
 * Compute the working-day step deadline for a Sales-owned PO stage.
 * Returns a Date offset by +N working days from the anchor timestamp.
 */
function computeSalesStepDueAt(anchor = new Date(), days = 2) {
    return addWorkingDays(new Date(anchor.getTime()), days);
}

// ---------------------------------------------------------------------------
// rejectStage — move a PO backward to a prior stage (corrective action).
// Records is_rejection=true + reject_count_after in status history.
// Requires: reject_stage capability on sales_po, or superadmin/ceo bypass.
// Fires the full 4-part PO invariant via _writeStageTransition.
// ---------------------------------------------------------------------------
async function rejectStage({ actor, poId, toStatus, reason }) {
    if (!isValidStatus(toStatus)) {
        throw new ValidationError(`invalid target status: ${toStatus}`);
    }
    if (!reason || !reason.trim()) {
        throw new ValidationError('rejection requires a reason');
    }

    const perms = require('./permission.service');
    const caps = await perms.resolveCapabilities(actor.id, 'sales_po');
    if (!caps.has('reject_stage') && !caps.has('full_access')) {
        throw new ForbiddenError('lacks reject_stage capability');
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // C4: guard against soft-deleted POs
        const cur = await client.query(
            `SELECT id, po_number, current_status FROM purchase_orders
              WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [poId],
        );
        if (!cur.rowCount) throw new ValidationError('PO not found or deleted');

        const previousStatus = cur.rows[0].current_status;
        const previousIdx = STATUS_ORDER.indexOf(previousStatus);
        const targetIdx   = STATUS_ORDER.indexOf(toStatus);
        if (targetIdx >= previousIdx) {
            throw new ValidationError(
                `reject must go to an earlier stage (got ${toStatus} from ${previousStatus})`,
            );
        }

        // Count prior rejections to set reject_count_after.
        const rc = await client.query(
            `SELECT count(*)::int AS n FROM purchase_order_status_history
              WHERE po_id=$1 AND is_rejection=true`,
            [poId],
        );
        const newCount = rc.rows[0].n + 1;

        // Use shared helper so all 5 side-effects (update, history, tracking,
        // mirror sync, notification + WS) fire uniformly.
        await _writeStageTransition(client, {
            poId,
            poNumber:       cur.rows[0].po_number,
            previousStatus,
            newStatus:      toStatus,
            actor,
            note:           reason,
            kind:           'reject',
            rejectCountAfter: newCount,
        });

        await client.query('COMMIT');
        return { poId, previousStatus, newStatus: toStatus, rejectCountAfter: newCount };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// adminOverrideStage — skip to any arbitrary stage (forward or backward).
// Records is_admin_override=true in status history.
// Requires: admin_override_stage capability (superadmin/ceo bypass only —
// no role_permissions grants exist for this capability).
// Fires the full 4-part PO invariant via _writeStageTransition.
// ---------------------------------------------------------------------------
async function adminOverrideStage({ actor, poId, targetStatus, reason }) {
    if (!isValidStatus(targetStatus)) {
        throw new ValidationError(`invalid target status: ${targetStatus}`);
    }
    if (!reason || !reason.trim()) {
        throw new ValidationError('admin override requires a reason');
    }

    const perms = require('./permission.service');
    const caps = await perms.resolveCapabilities(actor.id, 'sales_po');
    if (!caps.has('admin_override_stage') && !caps.has('full_access')) {
        throw new ForbiddenError('lacks admin_override_stage capability');
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // C4: guard against soft-deleted POs
        const cur = await client.query(
            `SELECT id, po_number, current_status FROM purchase_orders
              WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [poId],
        );
        if (!cur.rowCount) throw new ValidationError('PO not found or deleted');

        const previousStatus = cur.rows[0].current_status;

        // Use shared helper so all 5 side-effects (update, history, tracking,
        // mirror sync, notification + WS) fire uniformly.
        await _writeStageTransition(client, {
            poId,
            poNumber:       cur.rows[0].po_number,
            previousStatus,
            newStatus:      targetStatus,
            actor,
            note:           reason,
            kind:           'override',
        });

        await client.query('COMMIT');
        return { poId, previousStatus, newStatus: targetStatus };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    STATUS_ORDER,
    STATUS_CODE,
    STATUS_TEMPLATE,
    STATUS_DEFAULT_RECIPIENTS,
    isValidStatus,
    statusIndex,
    pathFor,
    assertOnPath,
    getById,
    getByPoNumber,
    initializeFromSales,
    advanceStatus,
    flagOverdue,
    getHistory,
    computeSalesStepDueAt,
    rejectStage,
    adminOverrideStage,
};

'use strict';

const db = require('../config/database');
const notificationService = require('../services/notification.service');
const { workingDaysBetween } = require('../utils/workingDays');

// Background job: enforce MOD_admin_log §SLA Rule 3 / Technical §Ready-to-Deliver.
//
// When Technical sets installation_records.ready_to_deliver='Yes', the
// record's ready_to_deliver_at timestamp starts a 2-working-day countdown
// for Admin & Log to respond (acknowledge or dispatch). If the clock
// elapses without admin_log_response_status transitioning off 'pending',
// we emit admin_log.ready_to_deliver.overdue_response and mark the SLA
// tracker so the reminder fires only once.
//
// Scheduling: invoke run() from a cron/queue worker (e.g. hourly). The job
// is idempotent — it only emits a notification once per (installation_id,
// escalation window) because sla_tracking.escalation_sent_at is set after
// the first dispatch.

const RTD_ENTITY_TYPE = 'installation_records.ready_to_deliver';
const RTD_SPAREPART_ENTITY_TYPE = 'sparepart_records.ready_to_deliver';
const SLA_WORKING_DAYS = 2;

/**
 * Ensure an sla_tracking row exists for a given Ready-to-Deliver record.
 * Returns the row's id; creates the row on first sighting so that
 * escalation_sent_at bookkeeping survives restarts.
 */
async function ensureSlaRow(client, installation, entityType = RTD_ENTITY_TYPE) {
    const { rows: existing } = await client.query(
        `SELECT id, escalation_sent_at
           FROM sla_tracking
          WHERE entity_type = $1 AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [entityType, installation.id],
    );
    if (existing.length > 0) return existing[0];

    const { rows } = await client.query(
        `INSERT INTO sla_tracking
           (entity_type, entity_id, stage, due_at)
         VALUES ($1, $2, 'ready_to_deliver', $3)
         RETURNING id, escalation_sent_at`,
        [entityType, installation.id, installation.ready_to_deliver_at],
    );
    return rows[0];
}

async function findPendingReadyToDeliver(client) {
    const { rows } = await client.query(
        `SELECT ir.id, ir.related_job_order_id, ir.related_po_id,
                ir.ready_to_deliver_at,
                tjo.technical_job_order_number, tjo.product_or_equipment_name,
                po.po_number,
                'installation'::text AS source
           FROM installation_records ir
           LEFT JOIN technical_job_orders tjo ON tjo.id = ir.related_job_order_id
           LEFT JOIN purchase_orders po       ON po.id = ir.related_po_id
          WHERE ir.deleted_at IS NULL
            AND ir.ready_to_deliver = 'Yes'
            AND ir.admin_log_response_status = 'pending'
            AND ir.ready_to_deliver_at IS NOT NULL`,
    );
    return rows;
}

async function findPendingSparepartReadyToDeliver(client) {
    const { rows } = await client.query(
        `SELECT sp.id, sp.related_job_order_id, sp.related_po_id,
                sp.ready_to_deliver_at,
                tjo.technical_job_order_number, tjo.product_or_equipment_name,
                po.po_number,
                'sparepart'::text AS source
           FROM sparepart_records sp
           LEFT JOIN technical_job_orders tjo ON tjo.id = sp.related_job_order_id
           LEFT JOIN purchase_orders po       ON po.id = sp.related_po_id
          WHERE sp.deleted_at IS NULL
            AND sp.ready_to_deliver = 'Yes'
            AND sp.admin_log_response_status = 'pending'
            AND sp.ready_to_deliver_at IS NOT NULL`,
    );
    return rows;
}

async function flagAndNotify(client, installation, now) {
    const entityType = installation.source === 'sparepart'
        ? RTD_SPAREPART_ENTITY_TYPE
        : RTD_ENTITY_TYPE;
    const entityTable = installation.source === 'sparepart'
        ? 'sparepart_records'
        : 'installation_records';
    const sla = await ensureSlaRow(client, installation, entityType);
    if (sla.escalation_sent_at) {
        // Already escalated for this RTD signal. If Technical re-signals
        // later (rare — would require ready_to_deliver → No → Yes toggling),
        // acknowledgeReadyToDeliver clears overdue_at/escalation_sent_at so
        // the next timeout re-fires cleanly.
        return { emitted: false, reason: 'already_escalated' };
    }

    await client.query(
        `UPDATE sla_tracking
            SET overdue_at         = COALESCE(overdue_at, $2),
                escalation_sent_at = COALESCE(escalation_sent_at, $2)
          WHERE id = $1`,
        [sla.id, now],
    );

    const message = `Technical marked job `
        + `${installation.technical_job_order_number || installation.related_job_order_id} `
        + `Ready to Deliver on ${installation.ready_to_deliver_at.toISOString().slice(0, 10)}. `
        + 'Admin & Log has not responded within the 2-working-day SLA.';

    await notificationService.emit(client, {
        templateKey: 'admin_log.ready_to_deliver.overdue_response',
        title: `Ready-to-Deliver overdue: ${installation.po_number || 'PO'}`,
        message,
        module: 'admin_log',
        entityType: entityTable,
        entityId: installation.id,
        extraRoles: ['admin_log', 'superadmin', 'ceo'],
    });

    return { emitted: true };
}

/**
 * Scan pending Ready-to-Deliver records and fire reminders for any whose
 * ready_to_deliver_at is older than SLA_WORKING_DAYS working days ago.
 *
 * @returns {Promise<{scanned:number, escalated:number}>}
 */
async function run() {
    return db.withTransaction(async (c) => {
        const now = new Date();
        const pending = [
            ...(await findPendingReadyToDeliver(c)),
            ...(await findPendingSparepartReadyToDeliver(c)),
        ];

        let escalated = 0;
        for (const installation of pending) {
            const readyAt = installation.ready_to_deliver_at;
            const elapsed = workingDaysBetween(
                readyAt instanceof Date ? readyAt : new Date(readyAt),
                now,
            );
            if (elapsed < SLA_WORKING_DAYS) continue;

            const { emitted } = await flagAndNotify(c, installation, now);
            if (emitted) escalated += 1;
        }

        return { scanned: pending.length, escalated };
    });
}

module.exports = {
    run,
    RTD_ENTITY_TYPE,
    RTD_SPAREPART_ENTITY_TYPE,
    SLA_WORKING_DAYS,
};

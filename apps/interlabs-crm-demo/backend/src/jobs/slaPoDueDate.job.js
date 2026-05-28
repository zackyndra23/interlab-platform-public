'use strict';

const db = require('../config/database');
const notificationService = require('../services/notification.service');

// Background job: MOD_technical §SLA Rule 4 — 30 days before po_due_date,
// flag the Technical Job Order and emit technical.po.due_date_reminder to
// the assigned engineer + Technical team.
//
// Idempotency: each Job Order has a due_date_reminder_flag boolean. Once
// true, the job skips re-notification. If the PO due date is later revised
// forward past the 30-day window, an operator would need to clear the flag
// (Superadmin/CEO only) — outside the scope of this job.
//
// Scheduling: invoke run() from a daily cron. Safe to run more often; the
// flag guards duplicate emissions.

const REMINDER_WINDOW_DAYS = 30;

async function findDueSoonJobOrders(client) {
    const { rows } = await client.query(
        `SELECT tjo.id, tjo.technical_job_order_number, tjo.related_po_id,
                tjo.related_po_number, tjo.po_due_date,
                tjo.assigned_engineer_id, tjo.support_team_members
           FROM technical_job_orders tjo
          WHERE tjo.deleted_at IS NULL
            AND tjo.workflow_status IN ('draft','active')
            AND tjo.due_date_reminder_flag = false
            AND tjo.po_due_date IS NOT NULL
            AND tjo.po_due_date <= (CURRENT_DATE + ($1 || ' days')::interval)
            AND tjo.po_due_date >= CURRENT_DATE`,
        [String(REMINDER_WINDOW_DAYS)],
    );
    return rows;
}

async function flagAndNotify(client, jo) {
    await client.query(
        `UPDATE technical_job_orders
            SET due_date_reminder_flag = true,
                updated_at             = now()
          WHERE id = $1`,
        [jo.id],
    );

    const extraRecipientUserIds = [
        jo.assigned_engineer_id,
        ...(jo.support_team_members || []),
    ].filter(Boolean);

    await notificationService.emit(client, {
        templateKey: 'technical.po.due_date_reminder',
        title: `PO ${jo.related_po_number || jo.related_po_id} due in ≤30 days`,
        message: `Technical Job Order ${jo.technical_job_order_number} — `
            + `PO due on ${jo.po_due_date instanceof Date
                ? jo.po_due_date.toISOString().slice(0, 10)
                : jo.po_due_date}.`,
        module: 'technical',
        entityType: 'technical_job_orders',
        entityId: jo.id,
        extraRecipientUserIds,
        extraRoles: ['technical'],
    });
}

/**
 * Scan technical_job_orders and raise 30-day reminders.
 *
 * @returns {Promise<{scanned:number, reminded:number}>}
 */
async function run() {
    return db.withTransaction(async (c) => {
        const due = await findDueSoonJobOrders(c);
        for (const jo of due) {
            await flagAndNotify(c, jo);
        }
        return { scanned: due.length, reminded: due.length };
    });
}

module.exports = {
    run,
    REMINDER_WINDOW_DAYS,
};

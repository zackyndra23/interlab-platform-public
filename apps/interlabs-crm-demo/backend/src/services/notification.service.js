'use strict';

const db = require('../config/database');
const ws = require('../websocket');
const { getRedis, isAvailable } = require('../config/redis');

// Domain-event gateway. Services call emit() after any mutation whose business
// event matches a template_key. The template row is the switchboard:
//
//   * status = 'disabled'                    → suppress ALL delivery channels
//   * send_dashboard_notification_enabled    → write notifications rows
//   * send_email_enabled                     → enqueue to email_queue
//                                              (dispatch worker drains) and
//                                              log to notification_logs
//   * recipient_roles_json                   → JSON array of role_keys; each
//                                              expands to every active user
//                                              with that role
//
// Callers may also pass extraRecipients (user_ids) and extraRoles (role_keys)
// to widen the template's default recipient set for a specific event.
//
// Task 5.5 extensions:
//   * Fetches notification_template_extra_recipients for DB-side extras
//   * Filters out notification_user_mutes
//   * 60s Redis NX dedupe per (template_id, entity_id) pair
//   * Resolves sender via notification_sender.service for email_queue rows

/**
 * @param {import('pg').PoolClient|null} client  Transactional client, or null to use the pool.
 * @param {object} options
 * @param {string} options.templateKey
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.module]               related_module
 * @param {string} [options.entityType]           related_entity_type
 * @param {string} [options.entityId]             related_entity_id (uuid)
 * @param {string} [options.senderUserId]         sender_user_id (uuid)
 * @param {string[]} [options.extraRecipientUserIds]
 * @param {string[]} [options.extraRoles]
 * @returns {Promise<{skipped:boolean, deduped?:boolean, notificationIds:string[]}>}
 */
async function emit(client, options) {
    const runner = client || db;
    const {
        templateKey,
        title,
        message = null,
        module = null,
        entityType = null,
        entityId = null,
        senderUserId = null,
        extraRecipientUserIds = [],
        extraRoles = [],
    } = options;

    if (!templateKey) throw new Error('notification.emit requires templateKey');
    if (!title) throw new Error('notification.emit requires title');

    const tplRes = await runner.query(
        `SELECT id, status, recipient_roles_json,
                send_email_enabled, send_dashboard_notification_enabled,
                sender_id, subject, body
           FROM notification_templates
          WHERE template_key = $1`,
        [templateKey],
    );
    const template = tplRes.rows[0] || null;

    // Missing templates behave as enabled dashboard-only defaults so the system
    // still records the event; Superadmin/CEO can later register the template.
    const enabled = !template || template.status === 'enabled';
    if (!enabled) return { skipped: true, notificationIds: [] };

    const dashboard = template ? template.send_dashboard_notification_enabled : true;
    const email = template ? template.send_email_enabled : false;

    const templateRoles = Array.isArray(template?.recipient_roles_json)
        ? template.recipient_roles_json
        : [];
    const roleSet = new Set([...templateRoles, ...extraRoles].filter(Boolean));
    const userSet = new Set(extraRecipientUserIds.filter(Boolean));

    // Expand roles → user_ids (active only).
    if (roleSet.size > 0) {
        const { rows } = await runner.query(
            `SELECT id FROM users
              WHERE role = ANY($1::text[])
                AND account_status = 'active'
                AND deleted_at IS NULL`,
            [Array.from(roleSet)],
        );
        for (const r of rows) userSet.add(r.id);
    }

    // Add DB-side extra recipients for this template.
    if (template?.id) {
        const extrasRes = await runner.query(
            `SELECT user_id FROM notification_template_extra_recipients WHERE template_id=$1`,
            [template.id],
        );
        for (const r of extrasRes.rows) userSet.add(r.user_id);
    }

    // Filter out muted users (mute wins over all other recipient expansions).
    if (template?.id && userSet.size > 0) {
        const muted = await runner.query(
            `SELECT user_id FROM notification_user_mutes
              WHERE template_id=$1 AND user_id = ANY($2::uuid[])`,
            [template.id, [...userSet]],
        );
        for (const r of muted.rows) userSet.delete(r.user_id);
    }

    if (userSet.size === 0) return { skipped: false, notificationIds: [] };
    if (!dashboard && !email) return { skipped: true, notificationIds: [] };

    // 60s Redis NX dedupe keyed on (template_id, entity_id).
    // Only applies when both template and entityId are present.
    if (template?.id && entityId && isAvailable()) {
        const dedupeKey = `notif:dedupe:${template.id}:${entityId}`;
        const set = await getRedis().set(dedupeKey, '1', 'EX', 60, 'NX');
        if (set === null) {
            // Key already existed — suppress this duplicate emit.
            return { skipped: true, deduped: true, notificationIds: [] };
        }
    }

    // Resolve sender for email queue rows.
    let senderId = template?.sender_id || null;
    if (email && !senderId) {
        // Lazy fallback: look up noreply sender key from DB.
        const fb = await db.query(`SELECT id FROM notification_senders WHERE sender_key='noreply' LIMIT 1`);
        senderId = fb.rows[0]?.id || null;
    }

    const notificationIds = [];
    // Realtime pushes are queued during DB work and fired via setImmediate
    // below, so if `client` is a transaction it has a chance to commit
    // before the frontend receives a notification:new that references a
    // not-yet-visible row. Payload is self-contained so even on rollback
    // the UI just renders a ghost notification that the next REST refetch
    // will clear. Acceptable trade-off for push latency.
    const pushJobs = [];

    for (const recipientUserId of userSet) {
        if (dashboard) {
            const insert = await runner.query(
                `INSERT INTO notifications
                   (title, message, recipient_user_id, sender_user_id,
                    related_module, related_entity_type, related_entity_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, created_at`,
                [title, message, recipientUserId, senderUserId, module, entityType, entityId],
            );
            const inserted = insert.rows[0];
            notificationIds.push(inserted.id);

            // Per-delivery log for websocket/push fan-out observability.
            await runner.query(
                `INSERT INTO notification_logs
                   (notification_id, channel, status, attempted_at, completed_at)
                 VALUES ($1, 'dashboard', 'delivered', now(), now())`,
                [inserted.id],
            );

            pushJobs.push({
                userId: recipientUserId,
                payload: {
                    notification_id: inserted.id,
                    title,
                    message,
                    related_module: module,
                    related_entity_type: entityType,
                    related_entity_id: entityId,
                    created_at: inserted.created_at,
                },
            });
        }

        if (email) {
            // Create a notification row for email-only delivery if dashboard is off.
            let notificationIdForEmail;
            if (dashboard) {
                notificationIdForEmail = notificationIds[notificationIds.length - 1];
            } else {
                const insert = await runner.query(
                    `INSERT INTO notifications
                       (title, message, recipient_user_id, sender_user_id,
                        related_module, related_entity_type, related_entity_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING id`,
                    [title, message, recipientUserId, senderUserId, module, entityType, entityId],
                );
                notificationIdForEmail = insert.rows[0].id;
                notificationIds.push(notificationIdForEmail);
            }
            await runner.query(
                `INSERT INTO notification_logs
                   (notification_id, channel, status)
                 VALUES ($1, 'email', 'queued')`,
                [notificationIdForEmail],
            );

            // Fetch recipient email for the queue row.
            const uRes = await runner.query(`SELECT email FROM users WHERE id=$1`, [recipientUserId]);
            const toAddress = uRes.rows[0]?.email;
            if (toAddress) {
                // Enqueue in email_queue so the dispatch worker can deliver via provider.
                await runner.query(
                    `INSERT INTO email_queue
                       (to_address, subject, body_html, sender_id)
                     VALUES ($1, $2, $3, $4)`,
                    [
                        toAddress,
                        template?.subject || title,
                        template?.body || `<p>${message || title}</p>`,
                        senderId,
                    ],
                );
            }
        }
    }

    // Fire realtime pushes after the function returns. setImmediate runs
    // after the current microtask queue drains, so if `client` is a
    // transaction that is about to commit, the commit usually lands first.
    // The push uses the shared pool (`db`) for the follow-up unread-count
    // query so it can't see uncommitted rows from the transaction client.
    if (pushJobs.length > 0) {
        setImmediate(() => deliverRealtimePushes(pushJobs));
    }

    return { skipped: false, notificationIds };
}

async function deliverRealtimePushes(jobs) {
    for (const job of jobs) {
        try {
            ws.sendToUser(job.userId, 'notification:new', job.payload);
            const { rows } = await db.query(
                `SELECT count(*)::int AS c FROM notifications
                  WHERE recipient_user_id = $1 AND is_read = false`,
                [job.userId],
            );
            ws.sendToUser(job.userId, 'notification:count', {
                unread_count: rows[0].c,
            });
        } catch (err) {
            // Realtime is best-effort; log and continue so one bad push
            // doesn't break the rest of the batch.
            // eslint-disable-next-line no-console
            console.error('[notification] realtime push failed', {
                user_id: job.userId,
                error: err.message,
            });
        }
    }
}

async function getUnread(userId, limit = 5) {
    const { rows } = await db.query(
        `SELECT id, title, message, related_module, related_entity_type,
                related_entity_id, is_read, created_at
           FROM notifications
          WHERE recipient_user_id = $1 AND is_read = false
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limit],
    );
    return rows;
}

async function markRead(notificationId, userId) {
    const { rowCount } = await db.query(
        `UPDATE notifications
            SET is_read = true
          WHERE id = $1 AND recipient_user_id = $2`,
        [notificationId, userId],
    );
    if (rowCount > 0) setImmediate(() => pushUnreadCount(userId));
    return rowCount > 0;
}

async function markAllRead(userId) {
    await db.query(
        `UPDATE notifications
            SET is_read = true
          WHERE recipient_user_id = $1 AND is_read = false`,
        [userId],
    );
    setImmediate(() => pushUnreadCount(userId));
}

async function pushUnreadCount(userId) {
    try {
        const { rows } = await db.query(
            `SELECT count(*)::int AS c FROM notifications
              WHERE recipient_user_id = $1 AND is_read = false`,
            [userId],
        );
        ws.sendToUser(userId, 'notification:count', {
            unread_count: rows[0].c,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notification] pushUnreadCount failed', err.message);
    }
}

module.exports = { emit, getUnread, markRead, markAllRead };

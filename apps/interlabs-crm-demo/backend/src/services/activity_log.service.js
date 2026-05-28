'use strict';

const db = require('../config/database');

/**
 * Record one activity event. Fire-and-forget safe — caller should not await
 * if they don't want to block the response. Never throws; errors are swallowed
 * so a logging failure never breaks the main request.
 */
async function record({
    userId,
    userEmail,
    userRole,
    action,
    resourceType = null,
    resourceId = null,
    detail = null,
    ipAddress = null,
    userAgent = null,
}) {
    try {
        await db.query(
            `INSERT INTO activity_logs
               (user_id, user_email, user_role, action, resource_type, resource_id, detail, ip_address, user_agent)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                userId,
                userEmail,
                userRole,
                action,
                resourceType,
                resourceId,
                detail ? JSON.stringify(detail) : null,
                ipAddress,
                userAgent,
            ],
        );
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[activity_log] record failed:', err.message);
    }
}

/**
 * List logs with pagination + optional filters.
 * Filters: userId, action, resourceType, dateFrom, dateTo, search (email ILIKE).
 */
async function list({
    page = 1,
    limit = 50,
    userId,
    action,
    resourceType,
    dateFrom,
    dateTo,
    search,
} = {}) {
    const conditions = [];
    const params = [];
    let i = 1;

    if (userId)       { conditions.push(`user_id = $${i++}`);        params.push(userId); }
    if (action)       { conditions.push(`action = $${i++}`);         params.push(action); }
    if (resourceType) { conditions.push(`resource_type = $${i++}`);  params.push(resourceType); }
    if (dateFrom)     { conditions.push(`created_at >= $${i++}`);    params.push(dateFrom); }
    if (dateTo)       { conditions.push(`created_at <= $${i++}`);    params.push(dateTo); }
    if (search)       { conditions.push(`user_email ILIKE $${i++}`); params.push(`%${search}%`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) FROM activity_logs ${where}`;
    const dataSql = `
        SELECT id, user_id, user_email, user_role, action, resource_type, resource_id,
               detail, ip_address, created_at
          FROM activity_logs ${where}
         ORDER BY created_at DESC
         LIMIT $${i++} OFFSET $${i++}
    `;

    const offset = (page - 1) * limit;
    const [countRes, dataRes] = await Promise.all([
        db.query(countSql, params),
        db.query(dataSql, [...params, limit, offset]),
    ]);

    return {
        data: dataRes.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
    };
}

/**
 * Return recently-active users enriched with live WS state.
 * Includes any user with a live WS connection OR a non-null last_login_at,
 * ordered by most-recent login. Each row carries:
 *   is_online    — true if there is at least one live WS connection
 *   online_since — Date when the first WS connection was registered, or null
 *   connections  — number of concurrent WS tabs/connections (0 if offline)
 */
async function onlineUsers() {
    const wsState = require('../websocket/state');
    const connectedIds = wsState.getConnectedUserIds();
    const r = await db.query(
        `SELECT id, email, display_name, role, avatar_url, last_login_at
           FROM users
          WHERE account_status='active' AND (id = ANY($1::uuid[]) OR last_login_at IS NOT NULL)
          ORDER BY last_login_at DESC NULLS LAST
          LIMIT 50`,
        [connectedIds],
    );
    return r.rows.map((u) => ({
        ...u,
        is_online: connectedIds.includes(u.id),
        online_since: connectedIds.includes(u.id) ? wsState.getConnectedSince(u.id) : null,
        connections: wsState.getConnectionCount(u.id),
    }));
}

module.exports = { record, list, onlineUsers };

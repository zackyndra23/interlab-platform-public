'use strict';
// permission_override.service.js — Per-user capability override + cross-dept grant CRUD.
//
// Authority model:
//   - Superadmin / CEO only may issue or revoke per-user overrides.
//   - Future: capability `override_grant` extends this; out of scope for this task.
//
// Upsert semantics:
//   - (user_id, feature_id, capability_id, override_type) is the conflict key for
//     user_capability_overrides.
//   - (grantee_user_id, target_role_key, feature_id, capability_id) is the conflict
//     key for cross_dept_grants.
//   - ON CONFLICT re-activates the row (sets revoked_at = NULL) and refreshes metadata.
//
// Cache: per-user cache is invalidated (NOT the full set) after every mutation so
// the resolver immediately sees the change.

const db = require('../config/database');
const { ForbiddenError, ValidationError, NotFoundError } = require('../utils/errors');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

// ---------------------------------------------------------------------------
// Authority helpers
// ---------------------------------------------------------------------------

/**
 * Throws ForbiddenError unless the actor is Superadmin or CEO.
 *
 * @param {{ id: string, role: string }} actor
 */
function authorizeOverride(actor) {
    if (actor.role === 'superadmin' || actor.role === 'ceo') return;
    throw new ForbiddenError('only Superadmin/CEO may grant or deny per-user overrides');
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/**
 * Resolve actor email for activity logging.
 * Routes populate actor.email (from req.user); direct service calls may not.
 */
async function resolveActorEmail(actor) {
    if (actor.email) return actor.email;
    try {
        const r = await db.query(`SELECT email FROM users WHERE id = $1`, [actor.id]);
        return r.rows[0]?.email || 'system@internal';
    } catch {
        return 'system@internal';
    }
}

// ---------------------------------------------------------------------------
// Per-user override CRUD
// ---------------------------------------------------------------------------

/**
 * UPSERT a 'grant' override for (userId, featureId, capabilityId).
 * Re-activates the row if previously revoked.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.userId
 * @param {string} params.featureId
 * @param {string} params.capabilityId
 * @param {string|null} [params.reason]
 * @param {Date|string|null} [params.expiresAt]
 * @returns {Promise<object>} The upserted row.
 */
async function grant({ actor, userId, featureId, capabilityId, reason = null, expiresAt = null }) {
    authorizeOverride(actor);

    const r = await db.query(
        `INSERT INTO user_capability_overrides
           (user_id, feature_id, capability_id, override_type, reason, granted_by, expires_at)
         VALUES ($1, $2, $3, 'grant', $4, $5, $6)
         ON CONFLICT (user_id, feature_id, capability_id, override_type)
           DO UPDATE SET
             reason     = EXCLUDED.reason,
             expires_at = EXCLUDED.expires_at,
             granted_by = EXCLUDED.granted_by,
             granted_at = now(),
             revoked_at = NULL
         RETURNING *`,
        [userId, featureId, capabilityId, reason, actor.id, expiresAt],
    );

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'permission.override.granted',
            resourceType: 'user_capability_override',
            resourceId: r.rows[0]?.id,
            detail: { userId, featureId, capabilityId, type: 'grant' },
        });
    }).catch(() => { /* intentionally swallowed */ });

    await perms.invalidateUserCache(userId);
    return r.rows[0];
}

/**
 * UPSERT a 'deny' override for (userId, featureId, capabilityId).
 * Re-activates the row if previously revoked.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.userId
 * @param {string} params.featureId
 * @param {string} params.capabilityId
 * @param {string|null} [params.reason]
 * @param {Date|string|null} [params.expiresAt]
 * @returns {Promise<object>} The upserted row.
 */
async function deny({ actor, userId, featureId, capabilityId, reason = null, expiresAt = null }) {
    authorizeOverride(actor);

    const r = await db.query(
        `INSERT INTO user_capability_overrides
           (user_id, feature_id, capability_id, override_type, reason, granted_by, expires_at)
         VALUES ($1, $2, $3, 'deny', $4, $5, $6)
         ON CONFLICT (user_id, feature_id, capability_id, override_type)
           DO UPDATE SET
             reason     = EXCLUDED.reason,
             expires_at = EXCLUDED.expires_at,
             granted_by = EXCLUDED.granted_by,
             granted_at = now(),
             revoked_at = NULL
         RETURNING *`,
        [userId, featureId, capabilityId, reason, actor.id, expiresAt],
    );

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'permission.override.denied',
            resourceType: 'user_capability_override',
            resourceId: r.rows[0]?.id,
            detail: { userId, featureId, capabilityId, type: 'deny' },
        });
    }).catch(() => { /* intentionally swallowed */ });

    await perms.invalidateUserCache(userId);
    return r.rows[0];
}

/**
 * Soft-revoke an override by setting revoked_at = now().
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.userId
 * @param {string} params.featureId
 * @param {string} params.capabilityId
 * @param {'grant'|'deny'} params.overrideType
 * @returns {Promise<{ ok: true }>}
 */
async function revoke({ actor, userId, featureId, capabilityId, overrideType }) {
    authorizeOverride(actor);

    const result = await db.query(
        `UPDATE user_capability_overrides
            SET revoked_at = now()
          WHERE user_id       = $1
            AND feature_id    = $2
            AND capability_id = $3
            AND override_type = $4
            AND revoked_at IS NULL`,
        [userId, featureId, capabilityId, overrideType],
    );

    if (!result.rowCount) {
        throw new NotFoundError('override not found');
    }

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'permission.override.revoked',
            resourceType: 'user_capability_override',
            resourceId: null,
            detail: { userId, featureId, capabilityId, type: overrideType },
        });
    }).catch(() => { /* intentionally swallowed */ });

    await perms.invalidateUserCache(userId);
    return { ok: true };
}

/**
 * List active overrides (grant + deny) for a user, joined with friendly keys.
 * Active = revoked_at IS NULL AND not expired.
 *
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function listForUser(userId) {
    const r = await db.query(
        `SELECT o.*,
                f.feature_key,
                c.capability_key
           FROM user_capability_overrides o
           JOIN feature_definitions f    ON f.id = o.feature_id
           JOIN capability_definitions c ON c.id = o.capability_id
          WHERE o.user_id    = $1
            AND o.revoked_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())
          ORDER BY o.granted_at DESC`,
        [userId],
    );
    return r.rows;
}

// ---------------------------------------------------------------------------
// Cross-department grant CRUD
// ---------------------------------------------------------------------------

/**
 * UPSERT a cross-department grant for (granteeUserId, targetRoleKey, featureId, capabilityId).
 * Re-activates the row if previously revoked.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.granteeUserId
 * @param {string} params.targetRoleKey
 * @param {string} params.featureId
 * @param {string} params.capabilityId
 * @param {Date|string|null} [params.expiresAt]
 * @param {string|null} [params.notes]
 * @returns {Promise<object>} The upserted row.
 */
async function grantCrossDept({ actor, granteeUserId, targetRoleKey, featureId, capabilityId, expiresAt = null, notes = null }) {
    authorizeOverride(actor);

    const r = await db.query(
        `INSERT INTO cross_dept_grants
           (grantee_user_id, target_role_key, feature_id, capability_id, granted_by, expires_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (grantee_user_id, target_role_key, feature_id, capability_id)
           DO UPDATE SET
             expires_at = EXCLUDED.expires_at,
             notes      = EXCLUDED.notes,
             granted_by = EXCLUDED.granted_by,
             granted_at = now(),
             revoked_at = NULL
         RETURNING *`,
        [granteeUserId, targetRoleKey, featureId, capabilityId, actor.id, expiresAt, notes],
    );

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'cross_dept.grant.created',
            resourceType: 'cross_dept_grant',
            resourceId: r.rows[0]?.id,
            detail: { granteeUserId, targetRoleKey, featureId, capabilityId },
        });
    }).catch(() => { /* intentionally swallowed */ });

    await perms.invalidateUserCache(granteeUserId);
    return r.rows[0];
}

/**
 * Revoke a cross-department grant by ID, setting revoked_at = now().
 * Looks up the grantee to invalidate their cache.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.grantId - UUID of the cross_dept_grants row
 * @returns {Promise<{ ok: true }>}
 */
async function revokeCrossDept({ actor, grantId }) {
    authorizeOverride(actor);

    const r = await db.query(
        `UPDATE cross_dept_grants
            SET revoked_at = now()
          WHERE id = $1
         RETURNING grantee_user_id`,
        [grantId],
    );

    if (!r.rowCount) {
        throw new NotFoundError('cross-dept grant not found');
    }

    const granteeUserId = r.rows[0].grantee_user_id;

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'cross_dept.grant.revoked',
            resourceType: 'cross_dept_grant',
            resourceId: grantId,
            detail: { grantId, granteeUserId },
        });
    }).catch(() => { /* intentionally swallowed */ });

    await perms.invalidateUserCache(granteeUserId);
    return { ok: true };
}

/**
 * List active cross-department grants for a user, joined with friendly keys.
 * Active = revoked_at IS NULL AND not expired.
 *
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function listCrossDeptForUser(userId) {
    const r = await db.query(
        `SELECT g.*,
                f.feature_key,
                c.capability_key
           FROM cross_dept_grants g
           JOIN feature_definitions f    ON f.id = g.feature_id
           JOIN capability_definitions c ON c.id = g.capability_id
          WHERE g.grantee_user_id = $1
            AND g.revoked_at IS NULL
            AND (g.expires_at IS NULL OR g.expires_at > now())
          ORDER BY g.granted_at DESC`,
        [userId],
    );
    return r.rows;
}

module.exports = { grant, deny, revoke, listForUser, grantCrossDept, revokeCrossDept, listCrossDeptForUser };

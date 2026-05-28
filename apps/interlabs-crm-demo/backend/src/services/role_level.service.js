'use strict';
// role_level.service.js — CRUD for role_levels table.
//
// Authority model:
//   - Superadmin / CEO: may mutate any role's levels.
//   - Top-rank manager of a role: may mutate levels within that role only.
//   - Everyone else: ForbiddenError.
//
// All mutations invalidate the full permission cache (all users) because
// level_rank changes affect within-role inheritance in the 5-step resolver.

const db = require('../config/database');
const { ForbiddenError, ValidationError, ConflictError } = require('../utils/errors');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

// ---------------------------------------------------------------------------
// Authority helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when userId holds the highest-rank level in the given role.
 * Used to allow role managers to administer their own role's levels.
 */
async function isTopRankManagerOfRole(userId, roleKey) {
    const r = await db.query(
        `SELECT 1
           FROM users u
           JOIN role_levels rl ON rl.id = u.level_id
          WHERE u.id = $1
            AND u.role = $2
            AND u.deleted_at IS NULL
            AND rl.deleted_at IS NULL
            AND rl.level_rank = (
                SELECT MAX(rl2.level_rank)
                  FROM role_levels rl2
                 WHERE rl2.role_id = rl.role_id
                   AND rl2.deleted_at IS NULL
            )
          LIMIT 1`,
        [userId, roleKey],
    );
    return r.rowCount === 1;
}

/**
 * Throws ForbiddenError unless the actor may mutate levels for roleKey.
 */
async function authorizeLevelMutation({ actor, roleKey }) {
    if (actor.role === 'superadmin' || actor.role === 'ceo') return;
    if (await isTopRankManagerOfRole(actor.id, roleKey)) return;
    throw new ForbiddenError(
        'only Superadmin/CEO or the top-rank manager of the role may mutate levels',
    );
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an actor's email for activity logging.
 * Routes populate actor.email (from req.user); direct service calls may not.
 * Returns a fallback string so the NOT NULL column is always satisfied.
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new role level.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor - authenticated user
 * @param {string} params.roleKey
 * @param {string} params.levelKey
 * @param {string} params.levelName
 * @param {number} params.levelRank
 * @param {string} [params.dataScopeDefault='own']
 * @returns {Promise<object>} The inserted row.
 */
async function create({ actor, roleKey, levelKey, levelName, levelRank, dataScopeDefault = 'own' }) {
    await authorizeLevelMutation({ actor, roleKey });

    let r;
    try {
        r = await db.query(
            `INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
             SELECT id, $2, $3, $4, $5 FROM roles WHERE role_key = $1
             RETURNING *`,
            [roleKey, levelKey, levelName, levelRank, dataScopeDefault],
        );
    } catch (err) {
        if (err.code === '23505') {
            throw new ConflictError('a level with that key or rank already exists for this role');
        }
        throw err;
    }

    if (!r.rowCount) {
        throw new ValidationError(`unknown role: ${roleKey}`);
    }

    const level = r.rows[0];

    // Fire-and-forget — never let logging break the mutation.
    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'level.created',
            resourceType: 'role_level',
            resourceId: level.id,
            detail: { levelId: level.id, roleKey },
        });
    }).catch(() => {/* intentionally swallowed */});

    await perms.invalidateAll();
    return level;
}

/**
 * Partially update a role level.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.levelId - UUID of the role_level row
 * @param {{ levelName?: string, levelRank?: number, dataScopeDefault?: string }} params.patch
 * @returns {Promise<object>} The updated row.
 */
async function update({ actor, levelId, patch }) {
    const cur = await db.query(
        `SELECT rl.*, r.role_key
           FROM role_levels rl
           JOIN roles r ON r.id = rl.role_id
          WHERE rl.id = $1`,
        [levelId],
    );
    if (!cur.rowCount) throw new ValidationError('level not found');

    await authorizeLevelMutation({ actor, roleKey: cur.rows[0].role_key });

    const { levelName, levelRank, dataScopeDefault } = patch;

    let r;
    try {
        r = await db.query(
            `UPDATE role_levels
                SET level_name         = COALESCE($2, level_name),
                    level_rank         = COALESCE($3, level_rank),
                    data_scope_default = COALESCE($4, data_scope_default),
                    updated_at         = now()
              WHERE id = $1
              RETURNING *`,
            [levelId, levelName ?? null, levelRank ?? null, dataScopeDefault ?? null],
        );
    } catch (err) {
        if (err.code === '23505') {
            throw new ConflictError('a level with that key or rank already exists for this role');
        }
        throw err;
    }

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'level.updated',
            resourceType: 'role_level',
            resourceId: levelId,
            detail: { levelId, patch },
        });
    }).catch(() => {/* intentionally swallowed */});

    await perms.invalidateAll();
    return r.rows[0];
}

/**
 * Soft-delete a role level.
 * Blocks deletion when any active user is assigned to that level.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.levelId
 * @returns {Promise<{ ok: true }>}
 */
async function remove({ actor, levelId }) {
    const cur = await db.query(
        `SELECT rl.*, r.role_key
           FROM role_levels rl
           JOIN roles r ON r.id = rl.role_id
          WHERE rl.id = $1`,
        [levelId],
    );
    if (!cur.rowCount) throw new ValidationError('level not found');

    await authorizeLevelMutation({ actor, roleKey: cur.rows[0].role_key });

    const used = await db.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE level_id = $1 AND deleted_at IS NULL`,
        [levelId],
    );
    if (used.rows[0].n > 0) {
        throw new ConflictError(
            `cannot delete: level is still assigned to ${used.rows[0].n} user(s)`,
        );
    }

    await db.query(`UPDATE role_levels SET deleted_at = now() WHERE id = $1`, [levelId]);

    resolveActorEmail(actor).then((email) => {
        activityLog.record({
            userId: actor.id,
            userEmail: email,
            userRole: actor.role,
            action: 'level.deleted',
            resourceType: 'role_level',
            resourceId: levelId,
            detail: { levelId },
        });
    }).catch(() => {/* intentionally swallowed */});

    await perms.invalidateAll();
    return { ok: true };
}

/**
 * List all active (non-deleted) levels for a role, ordered by rank descending.
 *
 * @param {string} roleKey
 * @returns {Promise<object[]>}
 */
async function listByRole(roleKey) {
    const r = await db.query(
        `SELECT rl.*
           FROM role_levels rl
           JOIN roles r ON r.id = rl.role_id
          WHERE r.role_key = $1
            AND rl.deleted_at IS NULL
          ORDER BY rl.level_rank DESC`,
        [roleKey],
    );
    return r.rows;
}

module.exports = { create, update, remove, listByRole };

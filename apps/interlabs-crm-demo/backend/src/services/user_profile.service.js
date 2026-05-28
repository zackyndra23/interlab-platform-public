'use strict';
// user_profile.service.js — GET/PATCH /api/users/me/profile.
//
// Responsibilities:
//   - Read the calling user's identity fields (first_name, last_name, email,
//     phone, display_name, avatar_url, role).
//   - Update those fields with basic conflict detection for duplicate email.
//   - Auto-derive display_name on first save (when it is still null/blank).
//   - Fire an activity_log entry fire-and-forget after a successful update.

const db = require('../config/database');
const { ValidationError, ConflictError } = require('../utils/errors');
const activityLog = require('./activity_log.service');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the actor's email for activity logging.
 * Routes populate req.user.email; direct service callers may not.
 *
 * @param {{ id: string, email?: string }} actor
 * @returns {Promise<string>}
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
 * Return the calling user's profile fields.
 *
 * @param {string} userId
 * @returns {Promise<{
 *   first_name: string|null,
 *   last_name:  string|null,
 *   email:      string,
 *   phone:      string|null,
 *   display_name: string,
 *   avatar_url: string|null,
 *   role:       string,
 * }>}
 */
async function getProfile(userId) {
    const { rows } = await db.query(
        `SELECT first_name, last_name, email, phone, display_name, avatar_url, role,
                two_factor_method
           FROM users
          WHERE id = $1
            AND deleted_at IS NULL`,
        [userId],
    );

    if (!rows.length) {
        throw new ValidationError('User not found');
    }

    return rows[0];
}

/**
 * Update the calling user's profile identity fields.
 *
 * Rules:
 *   - email UNIQUE violation → ConflictError('email already in use')
 *   - display_name auto-init: if the current display_name is null or empty,
 *     set it to `first_name + ' ' + last_name`. If the user has already set
 *     a non-empty display_name, leave it alone.
 *   - activity_log 'auth.profile.updated' fired fire-and-forget.
 *
 * @param {{ userId: string, first_name: string, last_name: string, email: string, phone: string }} params
 * @returns {Promise<object>} The updated profile row.
 */
async function updateProfile({ userId, first_name, last_name, email, phone }) {
    // We need to know the current display_name to decide whether to auto-init it.
    const current = await getProfile(userId);

    const autoDisplayName =
        !current.display_name || current.display_name.trim() === ''
            ? `${first_name} ${last_name}`
            : current.display_name;

    let updated;
    try {
        const { rows } = await db.query(
            `UPDATE users
                SET first_name   = $1,
                    last_name    = $2,
                    email        = $3,
                    phone        = $4,
                    display_name = $5,
                    updated_at   = now()
              WHERE id = $6
                AND deleted_at IS NULL
            RETURNING first_name, last_name, email, phone, display_name, avatar_url, role,
                      two_factor_method`,
            [first_name, last_name, email.toLowerCase().trim(), phone, autoDisplayName, userId],
        );

        if (!rows.length) {
            throw new ValidationError('User not found');
        }

        updated = rows[0];
    } catch (err) {
        // Postgres unique_violation code = '23505'
        if (err.code === '23505' && err.constraint && err.constraint.includes('email')) {
            throw new ConflictError('email already in use');
        }
        throw err;
    }

    // Fire-and-forget: activity log must never block the response or surface
    // errors to the caller.
    resolveActorEmail({ id: userId, email: current.email })
        .then((resolvedEmail) => {
            activityLog.record({
                userId,
                userEmail: resolvedEmail,
                userRole: current.role,
                action: 'auth.profile.updated',
                resourceType: 'user',
                resourceId: userId,
                detail: { fields: ['first_name', 'last_name', 'email', 'phone'] },
            });
        })
        .catch(() => { /* intentionally swallowed */ });

    return updated;
}

module.exports = { getProfile, updateProfile };

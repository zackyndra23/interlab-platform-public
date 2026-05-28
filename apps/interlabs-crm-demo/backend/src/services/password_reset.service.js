'use strict';

const db = require('../config/database');
const { generateToken, hashToken } = require('../utils/invitation_token');
const { hashPassword } = require('../utils/initial_password');
const { validatePasswordStrength } = require('../utils/password_strength');
const { ValidationError } = require('../utils/errors');
const activityLog = require('./activity_log.service');
const env = require('../config/env');

const APP_BASE_URL = env.appBaseUrl || 'https://app.interlab-portal.com';
const EXPIRES_IN_MINUTES = 30;

/**
 * Request a password reset for the given email.
 *
 * Anti-enumeration: always returns {ok:true} regardless of whether the email
 * matches a user. Callers must not infer user existence from the response.
 *
 * @param {{ email: string, ip: string }} opts
 * @returns {Promise<{ok: true}>}
 */
async function requestReset({ email, ip }) {
    // 1. Look up user — silent no-op if not found.
    const userRes = await db.query(
        `SELECT id, display_name, email, role FROM users
          WHERE lower(email) = lower($1) AND deleted_at IS NULL
          LIMIT 1`,
        [email],
    );

    const user = userRes.rows[0];

    if (!user) {
        // Return silently — do not reveal non-existence.
        return { ok: true };
    }

    // 2. Invalidate any prior unused tokens for this user.
    await db.query(
        `UPDATE password_reset_tokens SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
    );

    // 3. Generate plaintext token (returned only via email) + hash to store.
    const plaintext = generateToken();   // 32-byte hex → 64-char string
    const tokenHash = hashToken(plaintext);

    // 4. Insert new reset token row.
    await db.query(
        `INSERT INTO password_reset_tokens
           (user_id, token_hash, expires_at, requested_ip)
         VALUES ($1, $2, now() + interval '${EXPIRES_IN_MINUTES} minutes', $3)`,
        [user.id, tokenHash, ip || 'unknown'],
    );

    // 5. Build reset URL.
    const resetUrl = `${APP_BASE_URL}/reset-password/${plaintext}`;

    // 6. Look up the password_reset_email notification template.
    const tplRes = await db.query(
        `SELECT id, status, subject, body, sender_id
           FROM notification_templates
          WHERE template_key = 'password_reset_email'
          LIMIT 1`,
    );

    const tpl = tplRes.rows[0];

    if (tpl && tpl.status === 'enabled' && tpl.subject && tpl.body) {
        const subject = tpl.subject
            .replace(/\{\{display_name\}\}/g, user.display_name || user.email)
            .replace(/\{\{reset_url\}\}/g, resetUrl)
            .replace(/\{\{expires_in_minutes\}\}/g, String(EXPIRES_IN_MINUTES));

        const body = tpl.body
            .replace(/\{\{display_name\}\}/g, user.display_name || user.email)
            .replace(/\{\{reset_url\}\}/g, resetUrl)
            .replace(/\{\{expires_in_minutes\}\}/g, String(EXPIRES_IN_MINUTES));

        // Queue email — fire and don't wait on caller path.
        // Columns: to_address, subject, body_html, sender_id (matches email_queue schema).
        db.query(
            `INSERT INTO email_queue (to_address, subject, body_html, sender_id)
             VALUES ($1, $2, $3, $4)`,
            [
                user.email,
                subject,
                body,
                tpl.sender_id || null,
            ],
        ).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[password_reset] email_queue insert failed:', err.message);
        });
    }

    // 7. Fire-and-forget activity log.
    activityLog.record({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'auth.password.reset.requested',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: ip || null,
    });

    return { ok: true };
}

/**
 * Consume a password reset token and set the new password.
 *
 * Atomically marks the token used, updates the password hash, and revokes
 * all active sessions so the user must re-login on all devices.
 *
 * @param {{ token: string, newPassword: string, ip: string }} opts
 * @returns {Promise<{ok: true}>}
 */
async function consumeReset({ token, newPassword, ip }) {
    // 1. Validate strength before touching the DB.
    const strengthErrors = validatePasswordStrength(newPassword);
    if (strengthErrors.length > 0) {
        throw new ValidationError(strengthErrors[0]);
    }

    // 2. Look up by token hash — only valid (unused, not expired) rows.
    const tokenHash = hashToken(token);
    const tokenRes = await db.query(
        `SELECT id, user_id, expires_at
           FROM password_reset_tokens
          WHERE token_hash = $1
            AND used_at IS NULL
          LIMIT 1`,
        [tokenHash],
    );

    const tokenRow = tokenRes.rows[0];

    // 3. Reject if not found or expired (generic message, no enumeration).
    if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
        throw new ValidationError('Reset link is invalid or expired');
    }

    // 4. Hash the new password.
    const newHash = await hashPassword(newPassword);

    // 5. Atomic transaction: update user, mark token used, revoke sessions.
    await db.withTransaction(async (client) => {
        await client.query(
            `UPDATE users
                SET password_hash = $2,
                    must_change_password = false,
                    updated_at = now()
              WHERE id = $1`,
            [tokenRow.user_id, newHash],
        );

        await client.query(
            `UPDATE password_reset_tokens
                SET used_at = now()
              WHERE id = $1`,
            [tokenRow.id],
        );

        await client.query(
            `DELETE FROM user_sessions WHERE user_id = $1`,
            [tokenRow.user_id],
        );
    });

    // 6. Fire-and-forget activity log.
    // Fetch user email+role for the log (outside transaction — read-only).
    db.query(`SELECT email, role FROM users WHERE id=$1`, [tokenRow.user_id])
        .then(({ rows }) => {
            const u = rows[0];
            if (!u) return;
            activityLog.record({
                userId: tokenRow.user_id,
                userEmail: u.email,
                userRole: u.role,
                action: 'auth.password.reset.completed',
                resourceType: 'user',
                resourceId: tokenRow.user_id,
                ipAddress: ip || null,
            });
        })
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[password_reset] activity log failed:', err.message);
        });

    return { ok: true };
}

module.exports = { requestReset, consumeReset };

'use strict';

const crypto = require('node:crypto');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const bcrypt = require('bcryptjs');
const argon2 = require('argon2');

const db = require('../config/database');
const { getRedis, awaitReady } = require('../config/redis');
const { encrypt, decrypt } = require('../utils/twofactor_crypto');
const { generateBackupCodes, verifyAndFindIndex } = require('../utils/twofactor_codes');
const { UnauthorizedError, ValidationError } = require('../utils/errors');
const activityLog = require('./activity_log.service');

const SERVICE_ISSUER = 'Interlab Portal';
const EMAIL_OTP_EXPIRES_MINUTES = 10;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const PENDING_TTL_SECONDS = 300; // 5 minutes

// ---------------------------------------------------------------------------
// TOTP Setup
// ---------------------------------------------------------------------------

/**
 * Generate a new TOTP secret + QR code for the given user.
 * Does NOT persist anything — call verifyTotpSetup() to confirm + save.
 *
 * @param {string} userId
 * @returns {Promise<{secret: string, qr_data_url: string, otpauth_uri: string}>}
 */
async function setupTotp(userId) {
    // Fetch user email for the otpauth label.
    const { rows } = await db.query(`SELECT email FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId]);
    if (!rows.length) throw new ValidationError('User not found');
    const email = rows[0].email;

    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(email, SERVICE_ISSUER, secret);
    const qrDataUrl = await qrcode.toDataURL(otpauthUri);

    return { secret, qr_data_url: qrDataUrl, otpauth_uri: otpauthUri };
}

// ---------------------------------------------------------------------------
// TOTP Verify + Enable
// ---------------------------------------------------------------------------

/**
 * Verify a TOTP code against the supplied (unencrypted) secret.
 * On success: encrypts the secret, generates backup codes, persists to DB.
 *
 * @param {{userId: string, secret: string, code: string}}
 * @returns {Promise<{backup_codes: string[]}>}
 */
async function verifyTotpSetup({ userId, secret, code }) {
    // Validate the code with a ±1 window (covers minor clock drift).
    authenticator.options = { window: 1 };
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) throw new ValidationError('Invalid verification code');

    const encryptedSecret = encrypt(secret);
    const { codes, hashes } = await generateBackupCodes();

    await db.query(
        `UPDATE users
            SET two_factor_method       = 'totp',
                two_factor_secret       = $2,
                two_factor_backup_codes = $3,
                two_factor_enabled_at   = now(),
                updated_at              = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [userId, encryptedSecret, hashes],
    );

    // Fire-and-forget activity log.
    _logActivity(userId, 'auth.2fa.enabled', { method: 'totp' });

    return { backup_codes: codes };
}

// ---------------------------------------------------------------------------
// Email 2FA Enable
// ---------------------------------------------------------------------------

/**
 * Enable email-based 2FA for the user (no code verification required —
 * they verify at login time via the OTP sent to their email).
 *
 * @param {string} userId
 * @returns {Promise<{ok: true}>}
 */
async function enableEmail(userId) {
    await db.query(
        `UPDATE users
            SET two_factor_method       = 'email',
                two_factor_secret       = NULL,
                two_factor_backup_codes = NULL,
                two_factor_enabled_at   = now(),
                updated_at              = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
    );

    _logActivity(userId, 'auth.2fa.enabled', { method: 'email' });

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Disable 2FA
// ---------------------------------------------------------------------------

/**
 * Disable 2FA for the user. Requires current password + (if method=totp)
 * a valid TOTP code or backup code.
 *
 * Also revokes all active sessions, forcing re-login on all devices.
 *
 * @param {{userId: string, currentPassword: string, code: string|null}}
 * @returns {Promise<{ok: true}>}
 */
async function disable({ userId, currentPassword, code }) {
    // 1. Fetch user state.
    const { rows } = await db.query(
        `SELECT password_hash, two_factor_method, two_factor_secret,
                two_factor_backup_codes, email, role
           FROM users
          WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
    );
    if (!rows.length) throw new UnauthorizedError('User not found');

    const user = rows[0];

    // 2. Verify current password (argon2id first, bcrypt fallback).
    let passwordOk = false;
    if (user.password_hash && user.password_hash.startsWith('$argon2')) {
        try {
            passwordOk = await argon2.verify(user.password_hash, String(currentPassword));
        } catch { passwordOk = false; }
    } else {
        passwordOk = await bcrypt.compare(String(currentPassword), user.password_hash || '');
    }
    if (!passwordOk) throw new UnauthorizedError('Current password is incorrect');

    // 3. If TOTP is active, also require a valid code (TOTP or backup).
    if (user.two_factor_method === 'totp') {
        if (!code) throw new ValidationError('Verification code required to disable TOTP');
        const totpOk = await verifyTotpCode({ userId, code });
        const backupOk = totpOk ? false : await verifyBackupCode({ userId, code });
        if (!totpOk && !backupOk) {
            throw new UnauthorizedError('Invalid verification code');
        }
    }

    // 4. Wipe 2FA columns and revoke sessions atomically.
    await db.withTransaction(async (client) => {
        await client.query(
            `UPDATE users
                SET two_factor_method       = 'disabled',
                    two_factor_secret       = NULL,
                    two_factor_backup_codes = NULL,
                    two_factor_enabled_at   = NULL,
                    updated_at              = now()
              WHERE id = $1`,
            [userId],
        );
        await client.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
    });

    _logActivity(userId, 'auth.2fa.disabled', {});

    return { ok: true };
}

// ---------------------------------------------------------------------------
// Pending login nonce (Redis)
// ---------------------------------------------------------------------------

function _pendingKey(nonce) {
    return `2fa:pending:${nonce}`;
}

/**
 * Store a short-lived pending login state in Redis.
 * @param {{userId: string, rememberMe: boolean, ip: string}}
 * @returns {Promise<string>} nonce
 */
async function generatePendingNonce({ userId, rememberMe, ip }) {
    const nonce = crypto.randomBytes(32).toString('hex');
    const payload = JSON.stringify({ user_id: userId, remember_me: rememberMe, ip, ts: Date.now() });

    // Wait briefly for Redis to be ready — covers the boot-warming case
    // where the very first 2FA login arrives before the connection has
    // reached 'ready' status.
    if (!(await awaitReady())) {
        throw new ValidationError('Authentication service temporarily unavailable. Please try again.');
    }

    await getRedis().set(_pendingKey(nonce), payload, 'EX', PENDING_TTL_SECONDS, 'NX');
    return nonce;
}

/**
 * Atomically read AND delete the pending login nonce. First caller wins; any
 * concurrent caller (e.g. a parallel /login/2fa-verify replay) gets null and
 * must restart the login flow. Uses Redis 6.2+ GETDEL.
 *
 * Note: a typo on the OTP also consumes the nonce — callers must throw on
 * verification failure rather than silently retrying with the same nonce.
 *
 * @param {string} nonce
 * @returns {Promise<{user_id: string, remember_me: boolean, ip: string, ts: number}|null>}
 */
async function consumePendingNonce(nonce) {
    if (!(await awaitReady())) return null;
    const raw = await getRedis().getdel(_pendingKey(nonce));
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Non-destructive read of the pending login payload. Used by the email
 * resend path which must keep the nonce alive across multiple resends.
 *
 * @param {string} nonce
 * @returns {Promise<{user_id: string, remember_me: boolean, ip: string, ts: number}|null>}
 */
async function peekPendingNonce(nonce) {
    if (!(await awaitReady())) return null;
    const raw = await getRedis().get(_pendingKey(nonce));
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Delete the pending login nonce. Rarely needed directly now that
 * consumePendingNonce is atomic — kept for explicit invalidation paths.
 * @param {string} nonce
 */
async function deletePendingNonce(nonce) {
    if (!(await awaitReady())) return;
    await getRedis().del(_pendingKey(nonce));
}

// ---------------------------------------------------------------------------
// Email OTP
// ---------------------------------------------------------------------------

/**
 * Generate a 6-digit OTP, store its SHA-256 hash, and enqueue an email.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function sendEmailOtp(userId) {
    // Generate 6-digit OTP.
    const otp = String(crypto.randomInt(100_000, 999_999));
    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_OTP_EXPIRES_MINUTES * 60 * 1000);

    // Invalidate any prior unused codes for this user.
    await db.query(
        `UPDATE two_factor_email_codes SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
    );

    await db.query(
        `INSERT INTO two_factor_email_codes (user_id, code_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, codeHash, expiresAt.toISOString()],
    );

    // Fetch user info for email substitutions.
    const userRes = await db.query(
        `SELECT email, display_name FROM users WHERE id=$1 AND deleted_at IS NULL`,
        [userId],
    );
    if (!userRes.rows.length) return;
    const user = userRes.rows[0];

    // Look up the two_factor_email_otp template.
    const tplRes = await db.query(
        `SELECT id, status, subject, body, sender_id
           FROM notification_templates
          WHERE template_key = 'two_factor_email_otp'
          LIMIT 1`,
    );
    const tpl = tplRes.rows[0];

    if (!tpl || tpl.status !== 'enabled') return;

    const displayName = user.display_name || user.email;
    const subject = (tpl.subject || '')
        .replace(/\{\{display_name\}\}/g, displayName)
        .replace(/\{\{code\}\}/g, otp)
        .replace(/\{\{expires_in_minutes\}\}/g, String(EMAIL_OTP_EXPIRES_MINUTES));

    const body = (tpl.body || '')
        .replace(/\{\{display_name\}\}/g, displayName)
        .replace(/\{\{code\}\}/g, otp)
        .replace(/\{\{expires_in_minutes\}\}/g, String(EMAIL_OTP_EXPIRES_MINUTES));

    db.query(
        `INSERT INTO email_queue (to_address, subject, body_html, sender_id)
         VALUES ($1, $2, $3, $4)`,
        [user.email, subject, body, tpl.sender_id || null],
    ).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[two_factor] email_queue insert failed:', err.message);
    });
}

// ---------------------------------------------------------------------------
// Verify Email OTP
// ---------------------------------------------------------------------------

/**
 * Verify a submitted 6-digit code against the stored hash.
 * @param {{userId: string, code: string}}
 * @returns {Promise<boolean>}
 */
async function verifyEmailOtp({ userId, code }) {
    // Locate the latest active code so we know which row to bump. The
    // returned attempts count is advisory — the authoritative cap is
    // enforced by the atomic UPDATE below.
    const { rows: lookup } = await db.query(
        `SELECT id, expires_at
           FROM two_factor_email_codes
          WHERE user_id = $1
            AND used_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [userId],
    );

    if (!lookup.length) {
        throw new ValidationError('No active verification code found. Please request a new one.');
    }

    if (new Date(lookup[0].expires_at) < new Date()) {
        throw new ValidationError('Verification code has expired. Please request a new one.');
    }

    // Atomic increment with cap. If 0 rows return, the cap is already hit
    // (or the row was used/expired between the lookup and here) — concurrent
    // attempts cannot both slip past attempts < MAX because the WHERE clause
    // is evaluated under the row lock taken by UPDATE.
    const { rows: bumped } = await db.query(
        `UPDATE two_factor_email_codes
            SET attempts = attempts + 1
          WHERE id = $1
            AND attempts < $2
            AND used_at IS NULL
            AND expires_at > now()
          RETURNING code_hash`,
        [lookup[0].id, EMAIL_OTP_MAX_ATTEMPTS],
    );

    if (!bumped.length) {
        throw new ValidationError('Too many failed attempts. Please request a new code.');
    }

    const submitted = crypto.createHash('sha256').update(String(code)).digest('hex');
    if (submitted !== bumped[0].code_hash) {
        return false;
    }

    // Mark used. The id+used_at IS NULL guard means a concurrent successful
    // verify (vanishingly unlikely after the atomic increment) is a no-op.
    await db.query(
        `UPDATE two_factor_email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
        [lookup[0].id],
    );

    return true;
}

// ---------------------------------------------------------------------------
// Verify TOTP Code
// ---------------------------------------------------------------------------

/**
 * Verify a 6-digit TOTP code against the user's stored (encrypted) secret.
 * @param {{userId: string, code: string}}
 * @returns {Promise<boolean>}
 */
async function verifyTotpCode({ userId, code }) {
    const { rows } = await db.query(
        `SELECT two_factor_secret FROM users
          WHERE id = $1 AND deleted_at IS NULL AND two_factor_method = 'totp'`,
        [userId],
    );

    if (!rows.length || !rows[0].two_factor_secret) return false;

    let secret;
    try {
        secret = decrypt(rows[0].two_factor_secret);
    } catch {
        return false;
    }

    authenticator.options = { window: 1 };
    return authenticator.verify({ token: String(code), secret });
}

// ---------------------------------------------------------------------------
// Verify Backup Code
// ---------------------------------------------------------------------------

/**
 * Verify a backup code. On match, removes the used hash from the stored array.
 * @param {{userId: string, code: string}}
 * @returns {Promise<boolean>}
 */
async function verifyBackupCode({ userId, code }) {
    const { rows } = await db.query(
        `SELECT two_factor_backup_codes FROM users
          WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
    );

    if (!rows.length) return false;

    const hashes = rows[0].two_factor_backup_codes;
    if (!Array.isArray(hashes) || hashes.length === 0) return false;

    const idx = await verifyAndFindIndex(String(code).toUpperCase(), hashes);
    if (idx === -1) return false;

    // Remove the consumed hash.
    const usedHash = hashes[idx];
    await db.query(
        `UPDATE users
            SET two_factor_backup_codes = array_remove(two_factor_backup_codes, $2),
                updated_at = now()
          WHERE id = $1`,
        [userId, usedHash],
    );

    return true;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function _logActivity(userId, action, detail) {
    // Fire-and-forget — fetch email/role asynchronously.
    db.query(`SELECT email, role FROM users WHERE id = $1`, [userId])
        .then(({ rows }) => {
            if (!rows[0]) return;
            activityLog.record({
                userId,
                userEmail: rows[0].email,
                userRole: rows[0].role,
                action,
                resourceType: 'user',
                resourceId: userId,
                detail,
            });
        })
        .catch(() => { /* intentionally swallowed */ });
}

module.exports = {
    setupTotp,
    verifyTotpSetup,
    enableEmail,
    disable,
    generatePendingNonce,
    consumePendingNonce,
    peekPendingNonce,
    deletePendingNonce,
    sendEmailOtp,
    verifyEmailOtp,
    verifyTotpCode,
    verifyBackupCode,
};

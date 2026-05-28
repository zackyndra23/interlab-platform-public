'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');

const env = require('../config/env');
const db = require('../config/database');
const { UnauthorizedError, BadRequestError, ValidationError, NotFoundError } = require('../utils/errors');
const activityLog = require('./activity_log.service');

// Authentication service.
//
// Responsibilities per CTX_master_context §AUTH / CTX_architecture §SECURITY:
//   - Verify email + bcrypt password + (optional) reCAPTCHA v2 token.
//   - Issue a short-lived JWT access token (1h).
//   - Issue an opaque refresh token persisted in user_sessions (hashed).
//     Default 7d; 30d when remember_me=true.
//   - Exchange a valid refresh token for a new access token (rotate optional).
//   - Revoke refresh tokens on logout.
//   - Load the current user (same shape as authMiddleware attaches to req.user,
//     extended with the RBAC role-scope fields).
//
// Design notes:
//   - Access tokens are self-contained (JWT, HS256 by default). No DB lookup
//     on the request hot path beyond the existing authMiddleware user fetch.
//   - Refresh tokens are OPAQUE random strings. What we store in
//     user_sessions.token_hash is SHA-256 of the opaque string; we never
//     persist the raw token. That keeps a DB leak from yielding session
//     replay.
//   - We do NOT rotate refresh tokens on refresh (matches OpenAPI
//     RefreshTokenResponseData which returns only a new access_token). The
//     refresh token lives until its expires_at or explicit logout.
//   - Failed login timing: bcrypt.compare is constant-time per input length
//     which is good; we also fetch-then-compare even on unknown emails to
//     avoid an early-return timing oracle.

const ACCESS_TOKEN_EXPIRES_IN = env.jwt.expiresIn;             // '1h'
const REFRESH_TOKEN_EXPIRES_IN_DEFAULT = env.jwt.refreshExpiresIn; // '7d'
const REMEMBER_ME_EXPIRES_IN = env.rememberMeRefreshExpiresIn;   // '30d'

// Expose what /health and tests want to know without forcing a token decode.
function accessTokenTtlSeconds() {
    return parseDurationSeconds(ACCESS_TOKEN_EXPIRES_IN);
}

// ---------------------------------------------------------------------------
// TOKEN HELPERS
// ---------------------------------------------------------------------------

function signAccessToken(user) {
    const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name,
    };
    return jwt.sign(payload, env.jwt.secret, {
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
        algorithm: 'HS256',
    });
}

// Refresh tokens are opaque: a 48-byte random string base64url-encoded.
// They carry no claims; the server looks them up in user_sessions.
function generateOpaqueToken() {
    return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Turn a string duration like '1h' / '7d' / '30d' into seconds. Matches
// jsonwebtoken's parsing rules without pulling in a new dep.
function parseDurationSeconds(d) {
    if (typeof d === 'number') return d;
    const m = /^(\d+)\s*([smhdw])?$/i.exec(String(d).trim());
    if (!m) throw new Error(`Invalid duration string: ${d}`);
    const value = Number(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    const mult = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 }[unit];
    return value * mult;
}

// ---------------------------------------------------------------------------
// reCAPTCHA
// ---------------------------------------------------------------------------

// Verifier is active only when RECAPTCHA_SECRET is set. Uses the global
// fetch shipped with Node 18+. Non-2xx response or verification failure
// throws UnauthorizedError with a clear code so clients can retry with a
// fresh challenge.
async function verifyRecaptcha(token, clientIp) {
    if (!env.recaptcha.secret) return; // verifier disabled in dev/test
    if (!token) {
        throw new UnauthorizedError('reCAPTCHA token is required');
    }
    const params = new URLSearchParams({
        secret: env.recaptcha.secret,
        response: token,
    });
    if (clientIp) params.set('remoteip', clientIp);

    let res;
    try {
        res = await fetch(env.recaptcha.verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
    } catch (err) {
        // Network failure against Google. Behaviour depends on strict mode:
        //   strict=true  (default in prod) — hard-fail so bots can't ride a
        //     Google outage. Operator must monitor for sustained errors.
        //   strict=false — soft-allow so a transient Google outage doesn't
        //     lock legitimate users out.
        // eslint-disable-next-line no-console
        console.error('[auth] reCAPTCHA verify network error', {
            strict: env.recaptcha.strict,
            error: err && err.message ? err.message : String(err),
        });
        if (env.recaptcha.strict) {
            throw new UnauthorizedError('reCAPTCHA verification unavailable');
        }
        return;
    }
    if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('[auth] reCAPTCHA verify HTTP', res.status);
        throw new UnauthorizedError('reCAPTCHA verification failed');
    }
    const body = await res.json();
    if (!body.success) {
        throw new UnauthorizedError('reCAPTCHA verification failed');
    }
}

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

async function createSession(client, { userId, rememberMe }) {
    const refreshToken = generateOpaqueToken();
    const tokenHash = hashToken(refreshToken);
    const ttlSeconds = parseDurationSeconds(
        rememberMe ? REMEMBER_ME_EXPIRES_IN : REFRESH_TOKEN_EXPIRES_IN_DEFAULT,
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await client.query(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt.toISOString()],
    );
    return { refreshToken, expiresAt };
}

async function revokeSession(tokenHash) {
    await db.query(
        `DELETE FROM user_sessions WHERE token_hash = $1`,
        [tokenHash],
    );
}

async function revokeAllSessionsForUser(userId) {
    await db.query(
        `DELETE FROM user_sessions WHERE user_id = $1`,
        [userId],
    );
}

async function findActiveSession(tokenHash) {
    const { rows } = await db.query(
        `SELECT id, user_id, expires_at
           FROM user_sessions
          WHERE token_hash = $1
            AND expires_at > now()
          LIMIT 1`,
        [tokenHash],
    );
    return rows[0] || null;
}

// Housekeeping — a client that never logs out accumulates expired rows.
// Not called from the request path; exposed for a future cleanup job.
async function purgeExpiredSessions() {
    const { rowCount } = await db.query(
        `DELETE FROM user_sessions WHERE expires_at <= now()`,
    );
    return rowCount;
}

// ---------------------------------------------------------------------------
// USER LOAD
// ---------------------------------------------------------------------------

// Loads the active user row + RBAC scope fields, shaped like the /me
// response in openapi.yaml §User. Called by /api/auth/me and also by
// login/refresh handlers so the returned LoginResponseData.user carries
// scope info the frontend can use to render menus.
// avatar_url is intentionally omitted from the profile SELECT.
// The frontend resolves avatars via GET /api/users/:id/avatar (presigned
// MinIO URL) through <AvatarDisplay />. Keeping avatar_url in the JWT
// payload / profile object would require re-issuing tokens on every avatar
// change, and a stale presigned URL in a JWT is useless anyway.
async function loadProfile(userId, runner = db) {
    const { rows } = await runner.query(
        `SELECT u.id, u.email, u.role, u.permission_level,
                u.display_name, u.account_status, u.must_change_password,
                u.created_at, u.updated_at,
                urs.managed_role_scope,
                COALESCE(urs.can_manage_same_role, false) AS can_manage_same_role,
                urs.feature_permission_scope
           FROM users u
           LEFT JOIN user_role_scope urs ON urs.user_id = u.id
          WHERE u.id = $1
            AND u.deleted_at IS NULL`,
        [userId],
    );
    return rows[0] || null;
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------

async function login({ email, password, recaptchaToken, rememberMe, clientIp }) {
    await verifyRecaptcha(recaptchaToken, clientIp);

    const normalizedEmail = String(email).trim().toLowerCase();

    // Fetch the row first even if we'll reject. bcrypt.compare against a
    // synthetic hash keeps the timing of the unknown-email path close to
    // the wrong-password path, avoiding the obvious user-enumeration
    // oracle.
    const { rows } = await db.query(
        `SELECT id, email, password_hash, role, display_name,
                account_status, deleted_at, two_factor_method
           FROM users
          WHERE lower(email) = $1`,
        [normalizedEmail],
    );
    const user = rows[0];

    const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKxGhuOYhcFDtmIYbTXB2kVc.JLb5Z8Y5VhwO';
    const hash = user ? user.password_hash : DUMMY_HASH;
    const passwordOk = await bcrypt.compare(String(password), hash);

    if (!user || !passwordOk) {
        throw new UnauthorizedError('Invalid email or password');
    }
    if (user.deleted_at !== null || user.account_status !== 'active') {
        throw new UnauthorizedError('Account is not active');
    }

    // 2FA gate: if the user has 2FA enabled, return a pending_token instead
    // of issuing a session. The client must complete the 2FA challenge via
    // POST /api/auth/login/2fa-verify to receive actual tokens.
    const twoFactorMethod = user.two_factor_method || 'disabled';
    if (twoFactorMethod === 'email' || twoFactorMethod === 'totp') {
        // Lazy-require to avoid circular dependency (two_factor.service requires
        // auth.service for completeLoginWith2fa, but auth.service is loaded
        // first). Safe because this path is only reached at runtime.
        const twoFactor = require('./two_factor.service');
        const nonce = await twoFactor.generatePendingNonce({
            userId: user.id,
            rememberMe: Boolean(rememberMe),
            ip: clientIp || null,
        });

        if (twoFactorMethod === 'email') {
            await twoFactor.sendEmailOtp(user.id);
        }

        return {
            requires_2fa: true,
            pending_token: nonce,
            method: twoFactorMethod,
        };
    }

    const profile = await loadProfile(user.id);
    if (!profile) {
        // Should not happen — we just fetched it — but keep the guard so
        // a half-deleted row cannot crash the handler.
        throw new UnauthorizedError('User not found');
    }

    // Create the refresh-token row in its own transaction so the insert
    // can't orphan partial rows if the access-token sign throws.
    const { refreshToken, expiresAt } = await db.withTransaction((c) =>
        createSession(c, { userId: user.id, rememberMe }),
    );

    const accessToken = signAccessToken(user);

    // Fire-and-forget: do not await. activity_log.record swallows errors.
    activityLog.record({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'auth.login.success',
        ipAddress: clientIp || null,
    });

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: accessTokenTtlSeconds(),
        refresh_expires_at: expiresAt.toISOString(),
        user: profile,
    };
}

// ---------------------------------------------------------------------------
// COMPLETE LOGIN WITH 2FA
// ---------------------------------------------------------------------------

/**
 * Second step of 2FA login. Consumes the pending_token, verifies the code,
 * then issues a full session (same shape as login response).
 *
 * @param {{pendingToken: string, code: string}}
 * @returns {Promise<{access_token, refresh_token, token_type, expires_in, refresh_expires_at, user}>}
 */
async function completeLoginWith2fa({ pendingToken, code, clientIp }) {
    const twoFactor = require('./two_factor.service');

    // Atomic consume: first caller wins. Any concurrent /login/2fa-verify
    // replay using the same pending_token receives null and must restart.
    // A typo on the OTP also consumes the nonce — that is the intended
    // trade-off (correctness over a small UX cost).
    const pending = await twoFactor.consumePendingNonce(pendingToken);
    if (!pending) {
        throw new ValidationError('Login session expired. Please sign in again.');
    }

    const { user_id: userId, remember_me: rememberMe } = pending;

    // Fetch the user + 2FA state.
    const { rows } = await db.query(
        `SELECT id, email, role, display_name, account_status, deleted_at,
                two_factor_method
           FROM users
          WHERE id = $1`,
        [userId],
    );
    const user = rows[0];
    if (!user || user.deleted_at !== null || user.account_status !== 'active') {
        throw new UnauthorizedError('Account is not active');
    }

    const method = user.two_factor_method;

    // Verify code against the appropriate method. Failures are logged so an
    // operator can spot brute-force attempts even though the rate limiter
    // already blocks them.
    let verificationOk = false;
    if (method === 'totp') {
        const totpOk = await twoFactor.verifyTotpCode({ userId, code: String(code) });
        const backupOk = totpOk ? false : await twoFactor.verifyBackupCode({ userId, code: String(code).toUpperCase() });
        verificationOk = totpOk || backupOk;
    } else if (method === 'email') {
        verificationOk = await twoFactor.verifyEmailOtp({ userId, code: String(code) });
    } else {
        // 2FA was disabled between login steps — issue session anyway.
        verificationOk = true;
    }

    if (!verificationOk) {
        activityLog.record({
            userId,
            userEmail: user.email,
            userRole: user.role,
            action: 'auth.2fa.failed',
            ipAddress: clientIp || null,
            detail: { method },
        });
        throw new UnauthorizedError('Invalid verification code');
    }

    const profile = await loadProfile(userId);
    if (!profile) throw new UnauthorizedError('User not found');

    const { refreshToken, expiresAt } = await db.withTransaction((c) =>
        createSession(c, { userId, rememberMe }),
    );
    const accessToken = signAccessToken(user);

    activityLog.record({
        userId,
        userEmail: user.email,
        userRole: user.role,
        action: 'auth.login.success',
        ipAddress: clientIp || null,
        detail: { method: '2fa', two_factor_method: method },
    });

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: accessTokenTtlSeconds(),
        refresh_expires_at: expiresAt.toISOString(),
        remember_me: rememberMe,
        user: profile,
    };
}

// ---------------------------------------------------------------------------
// RESEND 2FA EMAIL
// ---------------------------------------------------------------------------

/**
 * Re-send the email OTP for a pending 2FA challenge.
 * @param {string} pendingToken
 */
async function resend2faEmail(pendingToken) {
    const twoFactor = require('./two_factor.service');

    // Non-destructive read — resend must keep the nonce alive so the user
    // can submit the new code against the same pending session.
    const pending = await twoFactor.peekPendingNonce(pendingToken);
    if (!pending) {
        throw new ValidationError('Login session expired. Please sign in again.');
    }

    await twoFactor.sendEmailOtp(pending.user_id);
}

// ---------------------------------------------------------------------------
// REFRESH
// ---------------------------------------------------------------------------

async function refresh({ refreshToken }) {
    if (!refreshToken) {
        throw new BadRequestError('refresh_token is required');
    }
    const session = await findActiveSession(hashToken(refreshToken));
    if (!session) {
        throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Reload the user through the same path authMiddleware uses so a
    // deleted / suspended user can't keep minting access tokens.
    const { rows } = await db.query(
        `SELECT id, email, role, display_name, account_status, deleted_at
           FROM users
          WHERE id = $1`,
        [session.user_id],
    );
    const user = rows[0];
    if (!user || user.deleted_at !== null || user.account_status !== 'active') {
        // Defensive cleanup: a disabled user's sessions should not be
        // redeemable. Drop the session so future attempts return faster.
        await revokeSession(hashToken(refreshToken));
        throw new UnauthorizedError('Account is not active');
    }

    const accessToken = signAccessToken(user);
    return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: accessTokenTtlSeconds(),
    };
}

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------

// If the caller passes a refresh_token explicitly, revoke that one session.
// Otherwise revoke every session belonging to the current user — which is
// the safer default for a "log me out" button.
async function logout({ currentUserId, refreshToken }) {
    let revoked;
    if (refreshToken) {
        await revokeSession(hashToken(refreshToken));
        revoked = 1;
    } else if (!currentUserId) {
        return { revoked: 0 };
    } else {
        const before = await db.query(
            `SELECT count(*)::int AS c FROM user_sessions WHERE user_id = $1`,
            [currentUserId],
        );
        await revokeAllSessionsForUser(currentUserId);
        revoked = before.rows[0].c;
    }

    // Fire-and-forget log. Email/role aren't in scope, so look them up async.
    if (currentUserId) {
        db.query('SELECT email, role FROM users WHERE id = $1', [currentUserId])
            .then(({ rows }) => {
                if (rows[0]) {
                    activityLog.record({
                        userId: currentUserId,
                        userEmail: rows[0].email,
                        userRole: rows[0].role,
                        action: 'logout',
                    });
                }
            })
            .catch(() => { /* logging failure must never break logout */ });
    }

    return { revoked };
}

// ---------------------------------------------------------------------------
// ME
// ---------------------------------------------------------------------------

async function me(userId) {
    const profile = await loadProfile(userId);
    if (!profile) throw new UnauthorizedError('User not found');
    return profile;
}

// ---------------------------------------------------------------------------
// RESET TO BACKUP PASSWORD
// ---------------------------------------------------------------------------

// Reset a user's password to their stored backup hash. Superadmin/CEO only
// (enforced at the route via rbacGuard). Never exposes plaintext.
async function resetToBackup({ actor, targetUserId }) {
    const { rows } = await db.query(
        `SELECT backup_password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [targetUserId],
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const backup = rows[0].backup_password_hash;
    if (!backup) throw new ValidationError('No backup password set for this user');

    await db.query(
        `UPDATE users
            SET password_hash        = $2,
                must_change_password = true,
                updated_by           = $3,
                updated_at           = now()
          WHERE id = $1`,
        [targetUserId, backup, actor.id],
    );

    activityLog.record({
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: 'auth.password.reset_to_backup',
        resourceType: 'users',
        resourceId: targetUserId,
    }).catch(() => { /* logging must never break the mutation */ });

    return { ok: true };
}

// ---------------------------------------------------------------------------
// CHANGE PASSWORD
// ---------------------------------------------------------------------------

// Verifies the user's current password (argon2id first; falls back to legacy
// bcryptjs hash for users whose passwords were hashed before the argon2 migration).
// On success, hashes the new password with argon2id, writes it to the DB, and
// clears the must_change_password flag.
async function changePassword({ userId, currentPassword, newPassword }) {
    const { rows } = await db.query(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
    );
    if (rows.length === 0) throw new UnauthorizedError('User not found');

    const { password_hash: hash } = rows[0];

    // Try argon2 first (new format), then fall back to bcryptjs for legacy users.
    let passwordOk = false;
    if (hash && hash.startsWith('$argon2')) {
        try {
            passwordOk = await argon2.verify(hash, String(currentPassword));
        } catch {
            passwordOk = false;
        }
    } else {
        passwordOk = await bcrypt.compare(String(currentPassword), hash || '');
    }

    if (!passwordOk) {
        throw new UnauthorizedError('Current password is incorrect');
    }

    const newHash = await argon2.hash(String(newPassword), {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
    });

    await db.query(
        `UPDATE users
            SET password_hash        = $2,
                must_change_password = false,
                updated_at           = now()
          WHERE id = $1`,
        [userId, newHash],
    );
}

module.exports = {
    login,
    refresh,
    logout,
    me,
    changePassword,
    resetToBackup,
    completeLoginWith2fa,
    resend2faEmail,
    // Internal — exposed for tests, the future session-cleanup job, and the
    // activate endpoint which needs to issue a session without going through
    // the password-verify path.
    hashToken,
    loadProfile,
    purgeExpiredSessions,
    accessTokenTtlSeconds,
    signAccessToken,
    createSession,
};

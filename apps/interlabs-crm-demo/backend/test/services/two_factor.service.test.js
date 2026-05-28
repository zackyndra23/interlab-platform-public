'use strict';
// two_factor.service.test.js
// Integration tests for two_factor.service.js — Stage 6.
// Requires a live Postgres DB (interlab-data-net).

const { pool } = require('../helpers/db');
const { hashPassword } = require('../../src/utils/initial_password');
const { authenticator } = require('otplib');

// Ensure encryption key is present before requiring the service.
if (!process.env.TWO_FACTOR_ENCRYPTION_KEY) {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'a'.repeat(64);
}

const svc = require('../../src/services/two_factor.service');

// ---------------------------------------------------------------------------
// Fixture user
// ---------------------------------------------------------------------------

const FIXTURE_EMAIL = `2fa-svc-fixture-${Date.now()}@test.local`;
let userId;

beforeAll(async () => {
    // Ensure template exists for email OTP tests.
    await pool.query(`
        INSERT INTO notification_templates
          (template_key, template_name, feature_group, trigger_event,
           recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
           status, subject, body)
        VALUES
          ('two_factor_email_otp', 'Two-Factor Email OTP', 'auth',
           'auth.2fa.email.requested', '[]'::jsonb, true, false, 'enabled',
           'Your Interlab Portal verification code',
           '<p>Hello {{display_name}}, your code is {{code}}, expires in {{expires_in_minutes}} min.</p>')
        ON CONFLICT (template_key) DO UPDATE SET
          status     = 'enabled',
          subject    = EXCLUDED.subject,
          body       = EXCLUDED.body,
          updated_at = now()
    `);

    // Lookup a valid level_id for 'sales'.
    const lvl = await pool.query(`
        SELECT rl.id FROM role_levels rl
          JOIN roles r ON r.id = rl.role_id
         WHERE r.role_key = 'sales' AND rl.level_rank = 1 LIMIT 1`);

    const pwHash = await hashPassword('TestPass@2025!');
    const r = await pool.query(
        `INSERT INTO users
           (email, password_hash, role, level_id, display_name, account_status, must_change_password)
         VALUES ($1, $2, 'sales', $3, '2FA Test Fixture', 'active', false)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           two_factor_method = 'disabled',
           two_factor_secret = NULL,
           two_factor_backup_codes = NULL,
           two_factor_enabled_at = NULL
         RETURNING id`,
        [FIXTURE_EMAIL, pwHash, lvl.rows[0]?.id],
    );
    userId = r.rows[0].id;
});

afterAll(async () => {
    if (userId) {
        await pool.query(`DELETE FROM two_factor_email_codes WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM email_queue WHERE to_address = $1`, [FIXTURE_EMAIL]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
});

// Helper: reset user to disabled 2FA state.
async function resetUserTwoFactor() {
    await pool.query(
        `UPDATE users SET
           two_factor_method = 'disabled',
           two_factor_secret = NULL,
           two_factor_backup_codes = NULL,
           two_factor_enabled_at = NULL
         WHERE id = $1`,
        [userId],
    );
}

// ---------------------------------------------------------------------------
// setupTotp
// ---------------------------------------------------------------------------

describe('two_factor.service.setupTotp', () => {
    it('returns secret, qr_data_url, and otpauth_uri', async () => {
        const result = await svc.setupTotp(userId);
        expect(result).toMatchObject({
            secret: expect.any(String),
            qr_data_url: expect.stringMatching(/^data:image\/png;base64,/),
            otpauth_uri: expect.stringMatching(/^otpauth:\/\/totp\//),
        });
        expect(result.secret.length).toBeGreaterThan(10);
    });

    it('otpauth_uri contains the issuer name', async () => {
        const { otpauth_uri } = await svc.setupTotp(userId);
        expect(otpauth_uri).toContain('Interlab%20Portal');
    });

    it('does NOT persist the secret to the DB (pending until verify)', async () => {
        await svc.setupTotp(userId);
        const row = await pool.query(`SELECT two_factor_method FROM users WHERE id=$1`, [userId]);
        expect(row.rows[0].two_factor_method).toBe('disabled');
    });

    it('throws ValidationError for unknown userId', async () => {
        await expect(svc.setupTotp('00000000-0000-0000-0000-000000000000'))
            .rejects.toThrow(/User not found/);
    });
});

// ---------------------------------------------------------------------------
// verifyTotpSetup
// ---------------------------------------------------------------------------

describe('two_factor.service.verifyTotpSetup', () => {
    beforeEach(resetUserTwoFactor);

    it('returns backup_codes array on valid TOTP code', async () => {
        const { secret } = await svc.setupTotp(userId);
        const code = authenticator.generate(secret);
        const result = await svc.verifyTotpSetup({ userId, secret, code });

        expect(result.backup_codes).toBeInstanceOf(Array);
        expect(result.backup_codes).toHaveLength(10);
        // Each code should be 10 chars from the custom alphabet.
        expect(result.backup_codes[0]).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    });

    it('persists two_factor_method=totp and clears plaintext', async () => {
        const { secret } = await svc.setupTotp(userId);
        const code = authenticator.generate(secret);
        await svc.verifyTotpSetup({ userId, secret, code });

        const row = await pool.query(
            `SELECT two_factor_method, two_factor_secret, two_factor_backup_codes,
                    two_factor_enabled_at
               FROM users WHERE id=$1`,
            [userId],
        );
        expect(row.rows[0].two_factor_method).toBe('totp');
        expect(row.rows[0].two_factor_secret).not.toBeNull();
        expect(row.rows[0].two_factor_backup_codes).toHaveLength(10);
        expect(row.rows[0].two_factor_enabled_at).not.toBeNull();
    });

    it('stores encrypted secret (not plaintext)', async () => {
        const { secret } = await svc.setupTotp(userId);
        const code = authenticator.generate(secret);
        await svc.verifyTotpSetup({ userId, secret, code });

        const row = await pool.query(`SELECT two_factor_secret FROM users WHERE id=$1`, [userId]);
        // The stored value must NOT be the raw base32 secret.
        expect(row.rows[0].two_factor_secret).not.toBe(secret);
        // It must be a valid base64 string.
        expect(() => Buffer.from(row.rows[0].two_factor_secret, 'base64')).not.toThrow();
    });

    it('throws ValidationError for an invalid TOTP code', async () => {
        const { secret } = await svc.setupTotp(userId);
        await expect(svc.verifyTotpSetup({ userId, secret, code: '000000' }))
            .rejects.toThrow(/Invalid verification code/);
    });
});

// ---------------------------------------------------------------------------
// enableEmail
// ---------------------------------------------------------------------------

describe('two_factor.service.enableEmail', () => {
    beforeEach(resetUserTwoFactor);

    it('sets two_factor_method to email', async () => {
        await svc.enableEmail(userId);
        const row = await pool.query(`SELECT two_factor_method, two_factor_enabled_at FROM users WHERE id=$1`, [userId]);
        expect(row.rows[0].two_factor_method).toBe('email');
        expect(row.rows[0].two_factor_enabled_at).not.toBeNull();
    });

    it('returns {ok: true}', async () => {
        const result = await svc.enableEmail(userId);
        expect(result).toEqual({ ok: true });
    });
});

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

describe('two_factor.service.disable', () => {
    beforeEach(async () => {
        await resetUserTwoFactor();
        await svc.enableEmail(userId);
    });

    it('disables 2FA with correct password', async () => {
        const result = await svc.disable({
            userId,
            currentPassword: 'TestPass@2025!',
            code: null,
        });
        expect(result).toEqual({ ok: true });

        const row = await pool.query(`SELECT two_factor_method FROM users WHERE id=$1`, [userId]);
        expect(row.rows[0].two_factor_method).toBe('disabled');
    });

    it('throws UnauthorizedError for wrong password', async () => {
        await expect(svc.disable({
            userId,
            currentPassword: 'wrongpassword',
            code: null,
        })).rejects.toThrow(/Current password is incorrect/);
    });

    it('revokes all sessions on disable', async () => {
        // Plant a fake session.
        await pool.query(
            `INSERT INTO user_sessions (user_id, token_hash, expires_at)
             VALUES ($1, 'fakehash-2fa-disable-test', now() + interval '7 days')`,
            [userId],
        );

        await svc.disable({ userId, currentPassword: 'TestPass@2025!', code: null });

        const sessions = await pool.query(`SELECT id FROM user_sessions WHERE user_id=$1`, [userId]);
        expect(sessions.rowCount).toBe(0);
    });

    it('requires code when TOTP is enabled', async () => {
        // Set up TOTP first.
        await resetUserTwoFactor();
        const { secret } = await svc.setupTotp(userId);
        const setupCode = authenticator.generate(secret);
        await svc.verifyTotpSetup({ userId, secret, code: setupCode });

        // Wait a moment to get a different TOTP window if needed.
        await new Promise(r => setTimeout(r, 1000));
        const disableCode = authenticator.generate(secret);

        await expect(svc.disable({
            userId,
            currentPassword: 'TestPass@2025!',
            code: null,
        })).rejects.toThrow(/Verification code required/);

        const result = await svc.disable({
            userId,
            currentPassword: 'TestPass@2025!',
            code: disableCode,
        });
        expect(result).toEqual({ ok: true });
    });
});

// ---------------------------------------------------------------------------
// sendEmailOtp + verifyEmailOtp
// ---------------------------------------------------------------------------

describe('two_factor.service email OTP', () => {
    beforeEach(async () => {
        await pool.query(`DELETE FROM two_factor_email_codes WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM email_queue WHERE to_address = $1`, [FIXTURE_EMAIL]);
    });

    it('sendEmailOtp inserts a code row', async () => {
        await svc.sendEmailOtp(userId);
        await new Promise(r => setTimeout(r, 100));

        const rows = await pool.query(
            `SELECT id, expires_at, used_at, attempts
               FROM two_factor_email_codes WHERE user_id=$1 AND used_at IS NULL`,
            [userId],
        );
        expect(rows.rowCount).toBe(1);
        expect(new Date(rows.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('verifyEmailOtp returns false for wrong code', async () => {
        await svc.sendEmailOtp(userId);
        await new Promise(r => setTimeout(r, 100));

        const ok = await svc.verifyEmailOtp({ userId, code: '000000' });
        expect(ok).toBe(false);
    });

    it('verifyEmailOtp increments attempts on wrong code', async () => {
        await svc.sendEmailOtp(userId);
        await new Promise(r => setTimeout(r, 100));

        await svc.verifyEmailOtp({ userId, code: '000000' });

        const row = await pool.query(
            `SELECT attempts FROM two_factor_email_codes WHERE user_id=$1 AND used_at IS NULL`,
            [userId],
        );
        expect(row.rows[0].attempts).toBe(1);
    });

    it('verifyEmailOtp throws after exceeding max attempts', async () => {
        await svc.sendEmailOtp(userId);
        await new Promise(r => setTimeout(r, 100));

        // Submit 5 wrong codes.
        for (let i = 0; i < 5; i++) {
            try {
                await svc.verifyEmailOtp({ userId, code: '000000' });
            } catch { /* expected on last one */ }
        }

        await expect(svc.verifyEmailOtp({ userId, code: '000000' }))
            .rejects.toThrow(/Too many failed attempts/);
    });

    it('verifyEmailOtp throws when no active code exists', async () => {
        await expect(svc.verifyEmailOtp({ userId, code: '123456' }))
            .rejects.toThrow(/No active verification code/);
    });
});

// ---------------------------------------------------------------------------
// verifyTotpCode
// ---------------------------------------------------------------------------

describe('two_factor.service.verifyTotpCode', () => {
    let storedSecret;

    beforeAll(async () => {
        await resetUserTwoFactor();
        const { secret } = await svc.setupTotp(userId);
        storedSecret = secret;
        const code = authenticator.generate(secret);
        await svc.verifyTotpSetup({ userId, secret, code });
    });

    it('returns true for valid TOTP code', async () => {
        const code = authenticator.generate(storedSecret);
        expect(await svc.verifyTotpCode({ userId, code })).toBe(true);
    });

    it('returns false for invalid TOTP code', async () => {
        expect(await svc.verifyTotpCode({ userId, code: '000000' })).toBe(false);
    });

    it('returns false for user without TOTP', async () => {
        // Use a UUID that doesn't have TOTP set.
        expect(await svc.verifyTotpCode({ userId: '00000000-0000-0000-0000-000000000001', code: '123456' })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// verifyBackupCode
// ---------------------------------------------------------------------------

describe('two_factor.service.verifyBackupCode', () => {
    let backupCodes;

    beforeAll(async () => {
        await resetUserTwoFactor();
        const { secret } = await svc.setupTotp(userId);
        const code = authenticator.generate(secret);
        const result = await svc.verifyTotpSetup({ userId, secret, code });
        backupCodes = result.backup_codes;
    });

    it('returns true for a valid backup code', async () => {
        const result = await svc.verifyBackupCode({ userId, code: backupCodes[0] });
        expect(result).toBe(true);
    });

    it('removes the used backup code from the stored list', async () => {
        const row = await pool.query(`SELECT two_factor_backup_codes FROM users WHERE id=$1`, [userId]);
        // backupCodes[0] was already used in the previous test.
        expect(row.rows[0].two_factor_backup_codes).toHaveLength(9);
    });

    it('returns false for a code that has already been used', async () => {
        // backupCodes[0] was consumed above.
        const result = await svc.verifyBackupCode({ userId, code: backupCodes[0] });
        expect(result).toBe(false);
    });

    it('returns false for a completely invalid backup code', async () => {
        const result = await svc.verifyBackupCode({ userId, code: 'INVALIDCODE' });
        expect(result).toBe(false);
    });
});

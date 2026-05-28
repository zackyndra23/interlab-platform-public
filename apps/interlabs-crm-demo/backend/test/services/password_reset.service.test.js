'use strict';
// password_reset.service.test.js
// Tests for password_reset.service.js — Stage 5 of auth-features spec.
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).

const { pool } = require('../helpers/db');
const svc = require('../../src/services/password_reset.service');
const { generateToken, hashToken } = require('../../src/utils/invitation_token');
const { hashPassword } = require('../../src/utils/initial_password');

const FIXTURE_EMAIL = `forgot-pw-fixture-${Date.now()}@test.local`;
let userId;

beforeAll(async () => {
    // Ensure the password_reset_email template exists for email queue tests.
    await pool.query(`
        INSERT INTO notification_templates
          (template_key, template_name, feature_group, trigger_event,
           recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
           status, subject, body)
        VALUES
          ('password_reset_email', 'Password Reset Link', 'auth',
           'auth.password.reset.requested', '[]'::jsonb, true, false, 'enabled',
           'Reset your Interlab Portal password',
           '<p>Hello {{display_name}}, reset at {{reset_url}} — expires in {{expires_in_minutes}} minutes.</p>')
        ON CONFLICT (template_key) DO UPDATE SET
          status  = 'enabled',
          subject = EXCLUDED.subject,
          body    = EXCLUDED.body,
          updated_at = now()
    `);

    // Look up a valid level_id for 'sales' role rank 1.
    const lvl = await pool.query(`
        SELECT rl.id FROM role_levels rl
          JOIN roles r ON r.id = rl.role_id
         WHERE r.role_key = 'sales' AND rl.level_rank = 1 LIMIT 1`);

    const pwHash = await hashPassword('Initial@Password1!');

    const r = await pool.query(
        `INSERT INTO users
           (email, password_hash, role, level_id, display_name, account_status, must_change_password)
         VALUES ($1, $2, 'sales', $3, 'ForgotPW Fixture', 'active', false)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [FIXTURE_EMAIL, pwHash, lvl.rows[0]?.id],
    );
    userId = r.rows[0].id;
});

afterAll(async () => {
    if (userId) {
        await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM email_queue WHERE to_address = $1`, [FIXTURE_EMAIL]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
});

// ============================================================================
// requestReset
// ============================================================================

describe('password_reset.service.requestReset', () => {
    it('returns ok:true for unknown email without inserting a token row', async () => {
        const before = await pool.query(
            `SELECT COUNT(*) AS c FROM password_reset_tokens`,
        );
        const countBefore = Number(before.rows[0].c);

        const result = await svc.requestReset({
            email: 'definitely-does-not-exist@test.local',
            ip: '127.0.0.1',
        });

        expect(result).toEqual({ ok: true });

        const after = await pool.query(
            `SELECT COUNT(*) AS c FROM password_reset_tokens`,
        );
        // Row count must not have grown.
        expect(Number(after.rows[0].c)).toBe(countBefore);
    });

    it('returns ok:true for known email and inserts a token row', async () => {
        if (!userId) return;

        const result = await svc.requestReset({ email: FIXTURE_EMAIL, ip: '10.0.0.1' });
        expect(result).toEqual({ ok: true });

        const tokenRow = await pool.query(
            `SELECT * FROM password_reset_tokens
              WHERE user_id = $1 AND used_at IS NULL
              ORDER BY created_at DESC LIMIT 1`,
            [userId],
        );
        expect(tokenRow.rowCount).toBe(1);
        expect(new Date(tokenRow.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('queues an email when password_reset_email template is enabled', async () => {
        if (!userId) return;

        // Clean previous queue entries first.
        await pool.query(`DELETE FROM email_queue WHERE to_address = $1`, [FIXTURE_EMAIL]);

        await svc.requestReset({ email: FIXTURE_EMAIL, ip: '10.0.0.2' });

        // Allow the fire-and-forget insert to settle (it is a microtask — no real I/O delay needed).
        await new Promise((r) => setTimeout(r, 200));

        const qRow = await pool.query(
            `SELECT subject, body_html FROM email_queue
              WHERE to_address = $1
              ORDER BY created_at DESC LIMIT 1`,
            [FIXTURE_EMAIL],
        );
        expect(qRow.rowCount).toBeGreaterThan(0);
        expect(qRow.rows[0].subject).toMatch(/reset/i);
        expect(qRow.rows[0].body_html).toContain('app.interlab-portal.com/reset-password/');
    });

    it('invalidates prior unused tokens before inserting a new one', async () => {
        if (!userId) return;

        // First request.
        await svc.requestReset({ email: FIXTURE_EMAIL, ip: '10.0.0.3' });

        // Second request — should mark the first token used.
        await svc.requestReset({ email: FIXTURE_EMAIL, ip: '10.0.0.4' });

        const unusedRows = await pool.query(
            `SELECT id FROM password_reset_tokens
              WHERE user_id = $1 AND used_at IS NULL`,
            [userId],
        );
        // Only ONE unused token should exist (the most recent one).
        expect(unusedRows.rowCount).toBe(1);
    });
});

// ============================================================================
// consumeReset
// ============================================================================

describe('password_reset.service.consumeReset', () => {
    // Helper: plant a fresh token for the fixture user and return the plaintext.
    async function plantToken({ expiredMinutesAgo } = {}) {
        const plaintext = generateToken();
        const tokenHash = hashToken(plaintext);
        const expiresExpr = expiredMinutesAgo
            ? `now() - interval '${expiredMinutesAgo} minutes'`
            : `now() + interval '30 minutes'`;
        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
             VALUES ($1, $2, ${expiresExpr}, '127.0.0.1')`,
            [userId, tokenHash],
        );
        return plaintext;
    }

    it('throws ValidationError for a weak new password', async () => {
        if (!userId) return;
        const token = await plantToken();
        await expect(svc.consumeReset({
            token,
            newPassword: 'weak',
            ip: '127.0.0.1',
        })).rejects.toThrow(/Password must be at least/);
    });

    it('throws ValidationError for an already-used token', async () => {
        if (!userId) return;
        const plaintext = generateToken();
        const tokenHash = hashToken(plaintext);
        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, requested_ip)
             VALUES ($1, $2, now() + interval '30 minutes', now(), '127.0.0.1')`,
            [userId, tokenHash],
        );
        await expect(svc.consumeReset({
            token: plaintext,
            newPassword: 'StrongPass@2025!',
            ip: '127.0.0.1',
        })).rejects.toThrow(/invalid or expired/);
    });

    it('throws ValidationError for an expired token', async () => {
        if (!userId) return;
        const token = await plantToken({ expiredMinutesAgo: 60 });
        await expect(svc.consumeReset({
            token,
            newPassword: 'StrongPass@2025!',
            ip: '127.0.0.1',
        })).rejects.toThrow(/invalid or expired/);
    });

    it('throws ValidationError for a completely unknown token', async () => {
        const fakeToken = generateToken();  // not in DB
        await expect(svc.consumeReset({
            token: fakeToken,
            newPassword: 'StrongPass@2025!',
            ip: '127.0.0.1',
        })).rejects.toThrow(/invalid or expired/);
    });

    it('resets password successfully with a valid token', async () => {
        if (!userId) return;
        const token = await plantToken();

        const result = await svc.consumeReset({
            token,
            newPassword: 'NewStrong@Pass2025!',
            ip: '127.0.0.1',
        });
        expect(result).toEqual({ ok: true });

        // Password hash in DB should now be argon2id.
        const userRow = await pool.query(
            `SELECT password_hash, must_change_password FROM users WHERE id = $1`,
            [userId],
        );
        expect(userRow.rows[0].password_hash).toMatch(/^\$argon2id\$/);
        expect(userRow.rows[0].must_change_password).toBe(false);

        // Token must be marked used.
        const tokenRow = await pool.query(
            `SELECT used_at FROM password_reset_tokens
              WHERE token_hash = $1`,
            [hashToken(token)],
        );
        expect(tokenRow.rows[0].used_at).not.toBeNull();
    });

    it('revokes all sessions on successful reset', async () => {
        if (!userId) return;

        // Plant a fake session for the fixture user.
        await pool.query(
            `INSERT INTO user_sessions (user_id, token_hash, expires_at)
             VALUES ($1, 'fakehash-reset-test', now() + interval '7 days')`,
            [userId],
        );

        const token = await plantToken();

        await svc.consumeReset({
            token,
            newPassword: 'AnotherStrong@2026!',
            ip: '127.0.0.1',
        });

        const sessions = await pool.query(
            `SELECT id FROM user_sessions WHERE user_id = $1`,
            [userId],
        );
        expect(sessions.rowCount).toBe(0);
    });
});

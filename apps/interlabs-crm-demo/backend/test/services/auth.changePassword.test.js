'use strict';
// auth.changePassword.test.js
// Tests for auth.service.changePassword — Task 2.10.
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).

const { pool } = require('../helpers/db');
const auth = require('../../src/services/auth.service');

let userId;
const FIXTURE_EMAIL = 'change-password-fixture@test.local';

beforeAll(async () => {
    const { hashPassword } = require('../../src/utils/initial_password');
    const lvl = await pool.query(`
        SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id
         WHERE r.role_key='sales' AND rl.level_rank=1 LIMIT 1`);
    const r = await pool.query(
        `INSERT INTO users (email, password_hash, role, level_id, display_name, account_status, must_change_password)
         VALUES ($1, $2, 'sales', $3, 'Test Change PW User', 'active', true)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = true
         RETURNING id`,
        [FIXTURE_EMAIL, await hashPassword('known-test-pw-1234'), lvl.rows[0]?.id],
    );
    userId = r.rows[0].id;
});

afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email=$1`, [FIXTURE_EMAIL]);
});

describe('auth.changePassword', () => {
    it('rejects wrong current password', async () => {
        if (!userId) return;
        await expect(auth.changePassword({
            userId,
            currentPassword: 'definitely-wrong',
            newPassword: 'new-strong-pass-1',
        })).rejects.toThrow();
    });

    it('accepts correct current password and clears must_change_password', async () => {
        if (!userId) return;
        await auth.changePassword({
            userId,
            currentPassword: 'known-test-pw-1234',
            newPassword: 'brand-new-pw-5678',
        });
        const r = await pool.query(`SELECT must_change_password FROM users WHERE id=$1`, [userId]);
        expect(r.rows[0].must_change_password).toBe(false);
    });
});

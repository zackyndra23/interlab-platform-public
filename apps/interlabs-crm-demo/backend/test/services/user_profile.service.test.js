'use strict';
// user_profile.service.test.js
// Tests for user_profile.service.js — Stage 3 of auth-features spec.
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).

const { pool } = require('../helpers/db');
const svc = require('../../src/services/user_profile.service');
const { ValidationError, ConflictError } = require('../../src/utils/errors');

const FIXTURE_EMAIL = `profile-test-${Date.now()}@test.local`;
const OTHER_EMAIL   = `profile-other-${Date.now()}@test.local`;
let userId;
let otherUserId;

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
    // Resolve a level_id (any role, rank 1)
    const lvl = await pool.query(`
        SELECT rl.id FROM role_levels rl
        JOIN roles r ON r.id = rl.role_id
        WHERE r.role_key = 'sales' AND rl.level_rank = 1
        LIMIT 1
    `);
    const levelId = lvl.rows[0]?.id;

    // Primary test user — display_name is a non-null column so we provide a
    // non-empty value here; individual tests that need to test auto-derive
    // will reset it to an empty string via an explicit UPDATE before calling
    // updateProfile.
    const r1 = await pool.query(
        `INSERT INTO users
             (email, password_hash, role, level_id, display_name, account_status)
         VALUES ($1, 'fixture-hash', 'sales', $2, 'Profile Fixture', 'active')
         ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id, display_name = EXCLUDED.display_name
         RETURNING id`,
        [FIXTURE_EMAIL, levelId],
    );
    userId = r1.rows[0].id;

    // Secondary user — occupies the OTHER_EMAIL address so we can test duplicate-email conflict
    const r2 = await pool.query(
        `INSERT INTO users
             (email, password_hash, role, level_id, display_name, account_status)
         VALUES ($1, 'fixture-hash', 'sales', $2, 'Other User', 'active')
         ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
         RETURNING id`,
        [OTHER_EMAIL, levelId],
    );
    otherUserId = r2.rows[0].id;
});

afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [FIXTURE_EMAIL, OTHER_EMAIL]);
});

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe('user_profile.service.getProfile', () => {
    it('returns expected fields for an existing user', async () => {
        if (!userId) return;

        const profile = await svc.getProfile(userId);

        expect(profile).toMatchObject({
            email:        FIXTURE_EMAIL,
            role:         'sales',
        });
        // These fields exist on the object (may be null at this point)
        expect(Object.keys(profile)).toEqual(
            expect.arrayContaining(['first_name', 'last_name', 'email', 'phone', 'display_name', 'avatar_url', 'role']),
        );
    });

    it('throws ValidationError for a non-existent user id', async () => {
        await expect(
            svc.getProfile('00000000-0000-0000-0000-000000000000'),
        ).rejects.toThrow(ValidationError);
    });
});

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

describe('user_profile.service.updateProfile', () => {
    it('updates fields successfully and returns the updated profile', async () => {
        if (!userId) return;

        const updated = await svc.updateProfile({
            userId,
            first_name: 'Tester',
            last_name:  'Profile',
            email:      FIXTURE_EMAIL,
            phone:      '+628123456789',
        });

        expect(updated.first_name).toBe('Tester');
        expect(updated.last_name).toBe('Profile');
        expect(updated.email).toBe(FIXTURE_EMAIL);
        expect(updated.phone).toBe('+628123456789');

        // Verify persisted in DB
        const row = await pool.query(
            `SELECT first_name, last_name, phone FROM users WHERE id = $1`,
            [userId],
        );
        expect(row.rows[0].first_name).toBe('Tester');
        expect(row.rows[0].last_name).toBe('Profile');
        expect(row.rows[0].phone).toBe('+628123456789');
    });

    it('auto-derives display_name when it is null/empty on first save', async () => {
        if (!userId) return;

        // Ensure display_name is empty string before testing auto-derive.
        // The column is NOT NULL so we use an empty string rather than NULL.
        // The service treats both null and '' as "not yet set".
        await pool.query(`UPDATE users SET display_name = '' WHERE id = $1`, [userId]);

        const updated = await svc.updateProfile({
            userId,
            first_name: 'Auto',
            last_name:  'Derived',
            email:      FIXTURE_EMAIL,
            phone:      '+628123456789',
        });

        expect(updated.display_name).toBe('Auto Derived');
    });

    it('does NOT override display_name when it is already set', async () => {
        if (!userId) return;

        // Pre-set a custom display_name
        await pool.query(
            `UPDATE users SET display_name = 'Custom Name' WHERE id = $1`,
            [userId],
        );

        const updated = await svc.updateProfile({
            userId,
            first_name: 'NewFirst',
            last_name:  'NewLast',
            email:      FIXTURE_EMAIL,
            phone:      '+628123456789',
        });

        // display_name should stay as the custom value, not "NewFirst NewLast"
        expect(updated.display_name).toBe('Custom Name');
    });

    it('throws ConflictError when email is already in use by another user', async () => {
        if (!userId || !otherUserId) return;

        await expect(
            svc.updateProfile({
                userId,
                first_name: 'Clash',
                last_name:  'Test',
                email:      OTHER_EMAIL,   // already used by otherUserId
                phone:      '+628123456789',
            }),
        ).rejects.toThrow(ConflictError);
    });

    it('fires an activity_log entry for auth.profile.updated', async () => {
        if (!userId) return;

        const logsBefore = await pool.query(
            `SELECT COUNT(*) AS c FROM activity_logs
              WHERE user_id = $1 AND action = 'auth.profile.updated'`,
            [userId],
        );
        const countBefore = Number(logsBefore.rows[0].c);

        await svc.updateProfile({
            userId,
            first_name: 'Log',
            last_name:  'Check',
            email:      FIXTURE_EMAIL,
            phone:      '+628123456789',
        });

        // Give the fire-and-forget a moment to settle (activity_log is async)
        await new Promise((resolve) => setTimeout(resolve, 300));

        const logsAfter = await pool.query(
            `SELECT COUNT(*) AS c FROM activity_logs
              WHERE user_id = $1 AND action = 'auth.profile.updated'`,
            [userId],
        );
        expect(Number(logsAfter.rows[0].c)).toBeGreaterThan(countBefore);
    });
});

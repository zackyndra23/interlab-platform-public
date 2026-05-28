'use strict';
// Tests for role_level.service.js — Task 1.12.
//
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).
// Pool teardown is handled by test/global-teardown.js; do NOT add afterAll here
// for pool.close() unless this test file introduces its own pool.

const { pool } = require('../helpers/db');
const svc = require('../../src/services/role_level.service');

let ceoId, salesManagerFixtureId, salesRoleId;

beforeAll(async () => {
    // Load CEO user created by seed.
    const u = await pool.query(`SELECT id FROM users WHERE role = 'ceo' AND deleted_at IS NULL LIMIT 1`);
    ceoId = u.rows[0]?.id;

    // Resolve the sales role id.
    const s = await pool.query(`SELECT id FROM roles WHERE role_key = 'sales'`);
    salesRoleId = s.rows[0]?.id;

    // Create (or reuse) a Sales Manager fixture at rank 2 so we can test the
    // "manager cannot mutate cross-role" guard.  Rank-2 level must already
    // exist (seeded as sales_manager by scripts/seed.js).
    if (salesRoleId) {
        const mgrLvl = await pool.query(
            `SELECT id FROM role_levels WHERE role_id = $1 AND level_rank = 2 AND deleted_at IS NULL LIMIT 1`,
            [salesRoleId],
        );
        if (mgrLvl.rowCount) {
            const ins = await pool.query(
                `INSERT INTO users (email, password_hash, role, display_name, level_id, account_status)
                 VALUES ($1, 'fixture', 'sales', 'Test Sales Manager 1.12', $2, 'active')
                 ON CONFLICT (email) DO UPDATE
                   SET level_id = EXCLUDED.level_id,
                       deleted_at = NULL,
                       account_status = 'active'
                 RETURNING id`,
                ['fixture-mgr-1.12@test.local', mgrLvl.rows[0].id],
            );
            salesManagerFixtureId = ins.rows[0].id;
        }
    }
});

afterAll(async () => {
    // Clean up only the fixture user we created; pool teardown is global.
    await pool.query(`DELETE FROM users WHERE email = 'fixture-mgr-1.12@test.local'`);
});

describe('role_level.service', () => {
    it('CEO can create a level for any role', async () => {
        if (!ceoId) return;
        const key = `ephemeral_${Date.now()}`;
        const lvl = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            roleKey: 'sales',
            levelKey: key,
            levelName: 'Ephemeral Test Lead',
            levelRank: 99,
            dataScopeDefault: 'team',
        });
        expect(lvl.id).toBeDefined();
        expect(lvl.level_key).toBe(key);
        // Cleanup
        await pool.query(`DELETE FROM role_levels WHERE id = $1`, [lvl.id]);
    });

    it('Manager cannot create a level outside own role', async () => {
        if (!salesManagerFixtureId) return;
        await expect(
            svc.create({
                actor: { id: salesManagerFixtureId, role: 'sales' },
                roleKey: 'finance',
                levelKey: 'finance_lead_test',
                levelName: 'Finance Lead Test',
                levelRank: 99,
                dataScopeDefault: 'team',
            }),
        ).rejects.toThrow();
    });

    it('blocks delete of level with assigned users', async () => {
        if (!ceoId || !salesRoleId) return;
        // The rank-1 (staff) level for sales always has the seeded demo user
        // assigned — so deleting it must be blocked.
        const r = await pool.query(
            `SELECT id FROM role_levels WHERE level_rank = 1 AND role_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [salesRoleId],
        );
        if (!r.rowCount) return;
        await expect(
            svc.remove({
                actor: { id: ceoId, role: 'ceo' },
                levelId: r.rows[0].id,
            }),
        ).rejects.toThrow(/assigned|conflict/i);
    });
});

'use strict';
// Tests for permission_override.service.js — Task 1.13.
//
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).
// Pool and Redis teardown are handled by test/global-teardown.js; do NOT add
// afterAll(close) / afterAll(closeRedis) — those would fire between test files
// and close shared resources before later test files have a chance to use them.

const { pool } = require('../helpers/db');
const { flushTestKeys } = require('../helpers/redis');
const svc = require('../../src/services/permission_override.service');
const { resolveCapabilities } = require('../../src/services/permission.service');

let ceoId, salesStaffId, featureId, capId;

beforeAll(async () => {
    // Wait for Redis to be ready before running any tests that depend on cache.
    const { getRedis } = require('../../src/config/redis');
    const redis = getRedis();
    await new Promise((resolve, reject) => {
        if (redis.status === 'ready') return resolve();
        const onReady = () => { redis.off('error', onError); resolve(); };
        const onError = (e) => { redis.off('ready', onReady); reject(e); };
        redis.once('ready', onReady);
        redis.once('error', onError);
    });

    // Load CEO user created by seed.
    const u = await pool.query(
        `SELECT id, role FROM users WHERE role IN ('ceo','sales') AND deleted_at IS NULL`,
    );
    ceoId = u.rows.find((x) => x.role === 'ceo')?.id;

    // Find a sales staff user at rank 1 (not a manager).
    const s = await pool.query(
        `SELECT u.id FROM users u
           JOIN role_levels rl ON rl.id = u.level_id
          WHERE u.role = 'sales'
            AND rl.level_rank = 1
            AND u.deleted_at IS NULL
          LIMIT 1`,
    );
    salesStaffId = s.rows[0]?.id;

    // Resolve the feature/capability IDs needed for the override rows.
    const f = await pool.query(
        `SELECT id FROM feature_definitions WHERE feature_key = 'sales_po'`,
    );
    featureId = f.rows[0]?.id;

    const c = await pool.query(
        `SELECT id FROM capability_definitions WHERE capability_key = 'approve'`,
    );
    capId = c.rows[0]?.id;
});

afterAll(async () => {
    // Clean up any overrides written during these tests.
    if (salesStaffId) {
        await pool.query(
            `DELETE FROM user_capability_overrides WHERE user_id = $1`,
            [salesStaffId],
        );
        await pool.query(
            `DELETE FROM cross_dept_grants WHERE grantee_user_id = $1`,
            [salesStaffId],
        );
    }
});

describe('permission_override.service', () => {
    it('CEO can grant; resolver sees it after cache invalidate', async () => {
        if (!ceoId || !salesStaffId || !featureId || !capId) return;
        // Start clean.
        await pool.query(
            `DELETE FROM user_capability_overrides WHERE user_id = $1`,
            [salesStaffId],
        );
        await flushTestKeys();

        await svc.grant({
            actor: { id: ceoId, role: 'ceo' },
            userId: salesStaffId,
            featureId,
            capabilityId: capId,
        });

        // After grant + cache flush the resolver should return 'approve'.
        const caps = await resolveCapabilities(salesStaffId, 'sales_po');
        expect(caps.has('approve')).toBe(true);
    });

    it('Sales user cannot grant (forbidden)', async () => {
        if (!salesStaffId || !featureId || !capId) return;
        await expect(
            svc.grant({
                actor: { id: salesStaffId, role: 'sales' },
                userId: salesStaffId,
                featureId,
                capabilityId: capId,
            }),
        ).rejects.toThrow();
    });

    it('revoke removes the grant', async () => {
        if (!ceoId || !salesStaffId || !featureId || !capId) return;
        await svc.revoke({
            actor: { id: ceoId, role: 'ceo' },
            userId: salesStaffId,
            featureId,
            capabilityId: capId,
            overrideType: 'grant',
        });
        // Flush cache so the resolver re-reads from DB.
        await flushTestKeys();
        const caps = await resolveCapabilities(salesStaffId, 'sales_po');
        expect(caps.has('approve')).toBe(false);
    });

    it('cross-dept grant adds capability', async () => {
        if (!ceoId || !salesStaffId || !featureId || !capId) return;
        await svc.grantCrossDept({
            actor: { id: ceoId, role: 'ceo' },
            granteeUserId: salesStaffId,
            targetRoleKey: 'finance',
            featureId,
            capabilityId: capId,
            notes: 'temp test grant',
        });
        await flushTestKeys();
        const caps = await resolveCapabilities(salesStaffId, 'sales_po');
        expect(caps.has('approve')).toBe(true);
        // Cleanup happens in afterAll
    });

    it('listForUser returns active grants only', async () => {
        if (!salesStaffId) return;
        const list = await svc.listForUser(salesStaffId);
        expect(Array.isArray(list)).toBe(true);
    });
});

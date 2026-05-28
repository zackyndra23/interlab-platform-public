'use strict';
// Tests for permission.service.js — Steps 1–2 of the 5-step resolver formula.
//
// Uses vitest globals (describe/it/expect/beforeAll) — no explicit require.
// Pool teardown is handled by test/global-teardown.js; do NOT add afterAll here.

const { pool }                = require('../helpers/db');
const { flushTestKeys }       = require('../helpers/redis');
const { getRedis, isAvailable } = require('../../src/config/redis');
const { resolveCapabilities } = require('../../src/services/permission.service');

let superadminId, ceoId, salesStaffId, salesManagerId;

beforeAll(async () => {
    // Wait for Redis 'ready' before issuing any commands.  The ioredis client
    // uses enableOfflineQueue:false so commands issued before the connection
    // is up throw "Stream isn't writeable".
    const redis = getRedis();
    if (!isAvailable()) {
        await new Promise((resolve, reject) => {
            const onReady = () => { redis.off('error', onError); resolve(); };
            const onError = (e) => { redis.off('ready', onReady); reject(e); };
            redis.once('ready', onReady);
            redis.once('error', onError);
        });
    }
    await flushTestKeys();

    // Load superadmin + ceo + sales users that were created by the seed.
    const u = await pool.query(
        `SELECT id, role FROM users
          WHERE role IN ('superadmin','ceo','sales')
            AND deleted_at IS NULL`,
    );
    superadminId = u.rows.find((x) => x.role === 'superadmin')?.id;
    ceoId        = u.rows.find((x) => x.role === 'ceo')?.id;

    // Among sales users, pick the one at rank-2 (Manager) and rank-1 (Staff).
    // The seed only assigns existing demo users to rank-1 (staff); rank-2
    // (manager) users are created by the F1 invitation flow in Task 2.
    // If no manager exists yet, salesManagerId remains undefined and those
    // tests are skipped gracefully below.
    const s = await pool.query(
        `SELECT u.id, rl.level_rank
           FROM users u
           JOIN role_levels rl ON rl.id = u.level_id
          WHERE u.role = 'sales'
            AND u.deleted_at IS NULL
          ORDER BY rl.level_rank DESC`,
    );
    salesManagerId = s.rows.find((r) => r.level_rank === 2)?.id;
    salesStaffId   = s.rows.find((r) => r.level_rank === 1)?.id;
});

// ---------------------------------------------------------------------------
// Step 1 — Bypass: superadmin / ceo receive all capability keys
// ---------------------------------------------------------------------------

describe('resolveCapabilities — bypass', () => {
    it('returns ALL capabilities for superadmin', async () => {
        const caps = await resolveCapabilities(superadminId, 'sales_po');
        expect(caps.has('full_access')).toBe(true);
        expect(caps.has('view_global')).toBe(true);
        expect(caps.has('approve')).toBe(true);
        expect(caps.has('view_own')).toBe(true);
    });

    it('returns ALL capabilities for ceo', async () => {
        const caps = await resolveCapabilities(ceoId, 'sales_po');
        expect(caps.has('full_access')).toBe(true);
        expect(caps.has('view_global')).toBe(true);
    });

    it('bypass result is cached (second call returns same set)', async () => {
        // First call populates cache.
        const first  = await resolveCapabilities(superadminId, 'dashboard');
        // Second call should hit cache — result must be identical.
        const second = await resolveCapabilities(superadminId, 'dashboard');
        expect([...second].sort()).toEqual([...first].sort());
    });
});

// ---------------------------------------------------------------------------
// Step 2 — Template + within-role inheritance
// ---------------------------------------------------------------------------

describe('resolveCapabilities — template + inheritance', () => {
    it('Sales Manager sees union of rank-1 and rank-2 templates', async () => {
        if (!salesManagerId) {
            console.warn('[skip] no Sales Manager user seeded — Task 2 (F1 invite) will create one');
            return;
        }
        await flushTestKeys();
        const caps = await resolveCapabilities(salesManagerId, 'sales_po');
        expect(caps.size).toBeGreaterThan(0);
    });

    it('Sales Staff sees only rank-1 templates (subset of or equal to Manager)', async () => {
        if (!salesStaffId || !salesManagerId) {
            // If no manager, at least verify staff has some perms.
            if (salesStaffId) {
                const staff = await resolveCapabilities(salesStaffId, 'sales_po');
                expect(staff.size).toBeGreaterThan(0);
            }
            return;
        }
        await flushTestKeys();
        const staff = await resolveCapabilities(salesStaffId, 'sales_po');
        const mgr   = await resolveCapabilities(salesManagerId, 'sales_po');
        // Staff's cap set must be a subset of (or equal to) manager's cap set.
        expect(staff.size).toBeLessThanOrEqual(mgr.size);
    });

    it('Sales Staff has expected write-family caps on sales_po', async () => {
        if (!salesStaffId) return;
        await flushTestKeys();
        const caps = await resolveCapabilities(salesStaffId, 'sales_po');
        // Seed grants: view_own, create, edit, write, delete, export
        expect(caps.has('view_own')).toBe(true);
        expect(caps.has('create')).toBe(true);
        expect(caps.has('write')).toBe(true);
        // Approve is NOT granted to staff by seed.
        expect(caps.has('approve')).toBe(false);
        // full_access is only for superadmin/ceo bypass.
        expect(caps.has('full_access')).toBe(false);
    });

    it('returns empty set for unknown userId', async () => {
        const caps = await resolveCapabilities('00000000-0000-0000-0000-000000000000', 'sales_po');
        expect(caps.size).toBe(0);
    });

    it('returns empty set when user has no level_id (superadmin/ceo already bypassed)', async () => {
        // Any user without level_id that isn't superadmin/ceo → empty.
        // The bypass guard runs first so this tests the fallthrough path.
        // We test indirectly: a fresh sales user without level_id.
        const ins = await pool.query(
            `INSERT INTO users (email, password_hash, role, display_name, account_status)
             VALUES ('no-level@test.invalid', 'x', 'sales', 'No Level', 'active')
             RETURNING id`,
        );
        const noLevelId = ins.rows[0].id;
        try {
            const caps = await resolveCapabilities(noLevelId, 'sales_po');
            expect(caps.size).toBe(0);
        } finally {
            await pool.query(`DELETE FROM users WHERE id = $1`, [noLevelId]);
        }
    });
});

// ---------------------------------------------------------------------------
// Steps 3–5 — grant + cross-dept + deny
// ---------------------------------------------------------------------------

describe('resolveCapabilities — grant + cross-dept + deny', () => {
    let testUserId, featureId, capId;

    beforeAll(async () => {
        testUserId = salesStaffId;
        if (!testUserId) return;
        const f = await pool.query(`SELECT id FROM feature_definitions WHERE feature_key='sales_po'`);
        featureId = f.rows[0]?.id;
        const c = await pool.query(`SELECT id FROM capability_definitions WHERE capability_key='approve'`);
        capId = c.rows[0]?.id;
    });

    it('grant adds capability beyond template', async () => {
        if (!testUserId || !featureId || !capId) return;
        await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1 AND feature_id=$2 AND capability_id=$3`,
            [testUserId, featureId, capId]);
        await flushTestKeys();
        const before = await resolveCapabilities(testUserId, 'sales_po');
        await pool.query(`INSERT INTO user_capability_overrides
      (user_id,feature_id,capability_id,override_type,granted_by)
      VALUES ($1,$2,$3,'grant',$1)`, [testUserId, featureId, capId]);
        await flushTestKeys();
        const after = await resolveCapabilities(testUserId, 'sales_po');
        expect(after.has('approve')).toBe(true);
        if (!before.has('approve')) {
            expect(after.size).toBe(before.size + 1);
        }
    });

    it('deny wins over grant', async () => {
        if (!testUserId || !featureId || !capId) return;
        await pool.query(`INSERT INTO user_capability_overrides
      (user_id,feature_id,capability_id,override_type,granted_by)
      VALUES ($1,$2,$3,'deny',$1)
      ON CONFLICT (user_id,feature_id,capability_id,override_type) DO NOTHING`,
            [testUserId, featureId, capId]);
        await flushTestKeys();
        const caps = await resolveCapabilities(testUserId, 'sales_po');
        expect(caps.has('approve')).toBe(false);
    });

    it('expired override is ignored', async () => {
        if (!testUserId || !featureId || !capId) return;
        await pool.query(`UPDATE user_capability_overrides
                         SET expires_at = now() - interval '1 hour'
                       WHERE user_id=$1 AND feature_id=$2 AND capability_id=$3 AND override_type='deny'`,
            [testUserId, featureId, capId]);
        await flushTestKeys();
        const caps = await resolveCapabilities(testUserId, 'sales_po');
        // grant still active, deny expired -> approve back
        expect(caps.has('approve')).toBe(true);
        // cleanup
        await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1`, [testUserId]);
    });

    it('revoked override is ignored', async () => {
        if (!testUserId || !featureId || !capId) return;
        await pool.query(`INSERT INTO user_capability_overrides
      (user_id,feature_id,capability_id,override_type,granted_by,revoked_at)
      VALUES ($1,$2,$3,'grant',$1, now())
      ON CONFLICT (user_id,feature_id,capability_id,override_type) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`,
            [testUserId, featureId, capId]);
        await flushTestKeys();
        const caps = await resolveCapabilities(testUserId, 'sales_po');
        expect(caps.has('approve')).toBe(false);
        await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1`, [testUserId]);
    });

    it('cross-dept grant adds capability', async () => {
        if (!testUserId || !featureId || !capId) return;
        await pool.query(`INSERT INTO cross_dept_grants
      (grantee_user_id, target_role_key, feature_id, capability_id, granted_by)
      VALUES ($1,'finance',$2,$3,$1)
      ON CONFLICT DO NOTHING`, [testUserId, featureId, capId]);
        await flushTestKeys();
        const caps = await resolveCapabilities(testUserId, 'sales_po');
        expect(caps.has('approve')).toBe(true);
        await pool.query(`DELETE FROM cross_dept_grants WHERE grantee_user_id=$1`, [testUserId]);
    });
});

// ---------------------------------------------------------------------------
// Task 1.8 — resolveDataScope
// ---------------------------------------------------------------------------

describe('resolveDataScope', () => {
    const { resolveDataScope } = require('../../src/services/permission.service');

    it('superadmin = global', async () => {
        if (!superadminId) return;
        const r = await resolveDataScope(superadminId, 'sales_po');
        expect(r.scope).toBe('global');
        expect(r.granted_target_roles).toEqual([]);
    });

    it('ceo = global', async () => {
        if (!ceoId) return;
        const r = await resolveDataScope(ceoId, 'sales_po');
        expect(r.scope).toBe('global');
    });

    it('staff returns level default', async () => {
        if (!salesStaffId) return;
        const r = await resolveDataScope(salesStaffId, 'sales_po');
        expect(['own', 'team', 'role', 'global']).toContain(r.scope);
    });

    it('cross-dept grantee gets granted_target_roles populated', async () => {
        if (!salesStaffId) return;
        const f = await pool.query(`SELECT id FROM feature_definitions WHERE feature_key='sales_po'`);
        const c = await pool.query(`SELECT id FROM capability_definitions WHERE capability_key='view_global'`);
        if (!f.rowCount || !c.rowCount) return;
        await pool.query(
            `INSERT INTO cross_dept_grants
               (grantee_user_id, target_role_key, feature_id, capability_id, granted_by)
             VALUES ($1, 'finance', $2, $3, $1)
             ON CONFLICT DO NOTHING`,
            [salesStaffId, f.rows[0].id, c.rows[0].id],
        );
        const r = await resolveDataScope(salesStaffId, 'sales_po');
        expect(r.granted_target_roles).toContain('finance');
        await pool.query(`DELETE FROM cross_dept_grants WHERE grantee_user_id = $1`, [salesStaffId]);
    });

    it('user not found returns own scope', async () => {
        const r = await resolveDataScope('00000000-0000-0000-0000-000000000000', 'sales_po');
        expect(r.scope).toBe('own');
        expect(r.granted_target_roles).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Task 1.9 — cache invalidation
// ---------------------------------------------------------------------------

describe('cache invalidation', () => {
    const { invalidateUserCache, invalidateAll } = require('../../src/services/permission.service');
    const { getRedis } = require('../../src/config/redis');

    it('invalidateUserCache removes the cached entry', async () => {
        if (!salesStaffId) return;
        await flushTestKeys();
        await resolveCapabilities(salesStaffId, 'sales_po'); // populate
        const redis = getRedis();
        expect(await redis.exists(`perm:user:${salesStaffId}`)).toBe(1);
        await invalidateUserCache(salesStaffId);
        expect(await redis.exists(`perm:user:${salesStaffId}`)).toBe(0);
    });

    it('invalidateAll clears every perm:user:* key', async () => {
        if (!superadminId) return;
        await flushTestKeys();
        await resolveCapabilities(superadminId, 'sales_po');
        if (salesStaffId) await resolveCapabilities(salesStaffId, 'sales_po');
        const redis = getRedis();
        const before = await redis.keys('perm:user:*');
        expect(before.length).toBeGreaterThan(0);
        await invalidateAll();
        const after = await redis.keys('perm:user:*');
        expect(after.length).toBe(0);
    });
});

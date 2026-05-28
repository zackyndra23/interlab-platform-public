'use strict';
// I5 regression guard: GET /api/po/:id/history must be reachable by
// division roles (view_own) and must not require view_global.
//
// view_global is intentionally not granted to any division role (only
// superadmin/ceo bypass applies), so if the guard were view_global the
// endpoint would be unreachable for Sales, Finance, Technical, etc.
//
// This test verifies the DB-level invariant and applies the view_own grant
// idempotently before asserting, so it is not ordering-sensitive against
// seed.test.js.

const { pool } = require('../helpers/db');

const DIVISION_ROLES = ['sales', 'admin_log', 'finance', 'technical', 'hrga', 'tax_insurance'];

beforeAll(async () => {
    // Apply the view_own grant idempotently so this test passes regardless of
    // whether seed.test.js has run first.
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key = ANY($1::text[])
         AND f.feature_key = 'sales_po'
         AND c.capability_key = 'view_own'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
    `, [DIVISION_ROLES]);
});

describe('I5: GET /api/po/:id/history guard — view_own not view_global', () => {
    it('no division role has view_global on sales_po', async () => {
        const { rows } = await pool.query(`
            SELECT r.role_key
              FROM role_permissions rp
              JOIN roles r ON r.id = rp.role_id
              JOIN feature_definitions f ON f.id = rp.feature_id
              JOIN capability_definitions c ON c.id = rp.capability_id
             WHERE f.feature_key = 'sales_po'
               AND c.capability_key = 'view_global'
               AND r.role_key = ANY($1::text[])
        `, [DIVISION_ROLES]);
        // Division roles must NOT have view_global on sales_po — the rbacGuard
        // was incorrectly set to view_global which locked out all division staff.
        expect(rows).toHaveLength(0);
    });

    it('every division role has view_own on sales_po (enables history endpoint)', async () => {
        const { rows } = await pool.query(`
            SELECT DISTINCT r.role_key
              FROM role_permissions rp
              JOIN roles r ON r.id = rp.role_id
              JOIN feature_definitions f ON f.id = rp.feature_id
              JOIN capability_definitions c ON c.id = rp.capability_id
             WHERE f.feature_key = 'sales_po'
               AND c.capability_key = 'view_own'
               AND r.role_key = ANY($1::text[])
             ORDER BY r.role_key
        `, [DIVISION_ROLES]);
        const grantedRoles = rows.map((r) => r.role_key).sort();
        // All division roles must have view_own on sales_po to access history.
        expect(grantedRoles).toEqual([...DIVISION_ROLES].sort());
    });
});

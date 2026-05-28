'use strict';
// Minimal schema-sanity tests for the admin permissions routes.
// We validate that the underlying DB tables have the seeded data the routes
// depend on. HTTP-level integration tests are covered by the existing rbacGuard
// middleware tests; here we confirm the data contract is satisfied.
//
// Uses vitest globals (describe/it/expect) — no explicit require.
// Pool teardown handled by test/global-teardown.js; do NOT add afterAll here.

const { pool } = require('../../helpers/db');

describe('admin permissions routes — schema sanity', () => {
    it('feature_definitions has admin_rbac', async () => {
        const r = await pool.query(`SELECT 1 FROM feature_definitions WHERE feature_key='admin_rbac'`);
        expect(r.rowCount).toBe(1);
    });

    it('capability_definitions has the expected keys', async () => {
        const r = await pool.query(`SELECT capability_key FROM capability_definitions ORDER BY capability_key`);
        const keys = r.rows.map(x => x.capability_key);
        expect(keys).toContain('view_global');
        expect(keys).toContain('edit');
        expect(keys).toContain('full_access');
    });
});

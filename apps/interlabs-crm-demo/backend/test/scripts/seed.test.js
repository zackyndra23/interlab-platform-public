'use strict';
const { pool } = require('../helpers/db');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

describe('seed script — levels', () => {
  it('produces a rank-2 manager level for each invitable role', async () => {
    const result = spawnSync('node', ['scripts/seed.js'], {
      cwd: path.resolve(__dirname, '../..'),  // backend/
      stdio: 'pipe',
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error(`seed exited ${result.status}: ${result.stderr?.toString() || result.stdout?.toString()}`);
    }
    const r = await pool.query(`
      SELECT r.role_key, rl.level_key, rl.level_rank, rl.data_scope_default
        FROM role_levels rl
        JOIN roles r ON r.id = rl.role_id
       WHERE rl.level_rank = 2
       ORDER BY r.role_key`);
    const keys = r.rows.map(x => x.role_key);
    expect(keys).toEqual(['admin_log','finance','hrga','sales','tax_insurance','technical']);
    expect(r.rows.every(x => x.data_scope_default === 'role')).toBe(true);
  });

  it('all existing users with non-bypass roles have level_id assigned', async () => {
    const r = await pool.query(`
      SELECT count(*)::int AS n FROM users u
       WHERE u.role NOT IN ('superadmin','ceo')
         AND u.deleted_at IS NULL
         AND u.level_id IS NULL`);
    expect(r.rows[0].n).toBe(0);
  });
});

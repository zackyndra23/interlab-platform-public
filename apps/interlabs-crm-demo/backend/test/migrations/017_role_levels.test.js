'use strict';
const { pool } = require('../helpers/db');

describe('migration 017 role_levels', () => {
  it('table role_levels exists with expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
       WHERE table_name = 'role_levels'
       ORDER BY column_name`);
    const cols = Object.fromEntries(r.rows.map(c => [c.column_name, c]));
    expect(cols.id).toBeDefined();
    expect(cols.role_id).toBeDefined();
    expect(cols.level_key).toBeDefined();
    expect(cols.level_name).toBeDefined();
    expect(cols.level_rank).toBeDefined();
    expect(cols.data_scope_default).toBeDefined();
  });

  it('users.level_id column exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='users' AND column_name='level_id'`);
    expect(r.rowCount).toBe(1);
  });

  it('role_permissions.level_id column exists and is NOT NULL', async () => {
    const r = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name='role_permissions' AND column_name='level_id'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].is_nullable).toBe('NO');
  });

  it('quad-unique constraint on role_permissions exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_constraint WHERE conname='role_permissions_quad_unique'`);
    expect(r.rowCount).toBe(1);
  });

  it('every role_permissions row points at a valid level for its role', async () => {
    // Manager-level grants (rank > 1) are valid — e.g. invite_user on admin_rbac.
    // The invariant is: the level_id must belong to the same role (no orphaned rows).
    const r = await pool.query(`
      SELECT count(*) FILTER (WHERE rl.id IS NULL)::int AS bad
        FROM role_permissions rp
        LEFT JOIN role_levels rl
          ON rl.id = rp.level_id AND rl.role_id = rp.role_id`);
    expect(r.rows[0].bad).toBe(0);
  });

  it('superadmin and ceo have no role_permissions rows after migration', async () => {
    const r = await pool.query(`
      SELECT count(*)::int AS n
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
       WHERE r.role_key IN ('superadmin','ceo')`);
    expect(r.rows[0].n).toBe(0);
  });

  it('role_levels enforces unique (role_id, level_rank) for active rows', async () => {
    // Migration 026 replaced the full unique constraint with a partial index
    // (WHERE deleted_at IS NULL) to allow soft-deleted rows to share key/rank.
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes
       WHERE tablename = 'role_levels'
         AND indexname = 'role_levels_unique_rank_active'`);
    expect(r.rowCount).toBe(1);
  });
});

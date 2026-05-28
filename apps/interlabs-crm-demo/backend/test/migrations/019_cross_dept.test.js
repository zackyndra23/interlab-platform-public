'use strict';
const { pool } = require('../helpers/db');

describe('migration 019 cross_dept_grants', () => {
  it('table exists with quad-unique', async () => {
    const t = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='cross_dept_grants'`);
    expect(t.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='cross_dept_grants_unique'`);
    expect(c.rowCount).toBe(1);
  });

  it('FK on target_role_key references roles(role_key)', async () => {
    const r = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'cross_dept_grants'::regclass
         AND contype  = 'f'
         AND pg_get_constraintdef(oid) LIKE '%target_role_key%'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].def).toMatch(/REFERENCES roles\s*\(\s*role_key\s*\)/i);
  });

  it('active partial index exists for grantee_user_id', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes
       WHERE tablename='cross_dept_grants'
         AND indexname='cross_dept_grants_grantee_idx'`);
    expect(r.rowCount).toBe(1);
  });
});

'use strict';
const { pool } = require('../helpers/db');

describe('migration 018 user_capability_overrides', () => {
  it('table exists with override_type CHECK', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name='user_capability_overrides'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname='user_overrides_type_chk'`);
    expect(c.rows[0].def).toMatch(/grant|deny/);
  });

  it('quad-unique constraint exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_constraint WHERE conname='user_overrides_unique'`);
    expect(r.rowCount).toBe(1);
  });

  it('active partial index exists for user_id', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes
       WHERE tablename='user_capability_overrides'
         AND indexname='user_overrides_active_idx'`);
    expect(r.rowCount).toBe(1);
  });
});

'use strict';
const { pool } = require('../helpers/db');

describe('migration 030 backup password', () => {
  it('users has a nullable text backup_password_hash column', async () => {
    const r = await pool.query(`
      SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'backup_password_hash'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toBe('text');
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});

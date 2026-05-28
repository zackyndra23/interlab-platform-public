'use strict';
const { pool } = require('../helpers/db');
describe('migration 033 users.last_login_at', () => {
  it('adds nullable timestamptz last_login_at', async () => {
    const r = await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name='users' AND column_name='last_login_at'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toBe('timestamp with time zone');
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});

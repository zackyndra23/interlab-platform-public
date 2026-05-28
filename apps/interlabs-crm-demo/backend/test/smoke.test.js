'use strict';
const { pool } = require('./helpers/db');

describe('smoke', () => {
  it('connects to postgres', async () => {
    const r = await pool.query('SELECT 1 AS one');
    expect(r.rows[0].one).toBe(1);
  });

  it('uses the test database, not production', async () => {
    const r = await pool.query('SELECT current_database() AS db');
    expect(r.rows[0].db).toBe('crmdemo_test');
  });
});

'use strict';
const { pool } = require('../helpers/db');

describe('migration 021 user avatars', () => {
  it('users.avatar_file_id column exists with FK to file_attachments', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='users' AND column_name='avatar_file_id'`);
    expect(r.rowCount).toBe(1);

    const fk = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = 'users'::regclass
         AND c.contype = 'f'
         AND pg_get_constraintdef(c.oid) LIKE '%avatar_file_id%'`);
    expect(fk.rowCount).toBe(1);
    expect(fk.rows[0].def).toMatch(/REFERENCES file_attachments/i);
    expect(fk.rows[0].def).toMatch(/ON DELETE SET NULL/i);
  });

  it('users.avatar_updated_at column exists (nullable timestamptz)', async () => {
    const r = await pool.query(`
      SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name='users' AND column_name='avatar_updated_at'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toMatch(/timestamp/i);
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});

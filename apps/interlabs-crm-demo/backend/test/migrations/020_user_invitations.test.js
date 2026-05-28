'use strict';
const { pool } = require('../helpers/db');

describe('migration 020 user_invitations', () => {
  it('table user_invitations exists with expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='user_invitations' ORDER BY column_name`);
    const cols = r.rows.map(x => x.column_name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','email','role_key','level_id','invited_by_user_id','inviter_role_key',
      'activation_token_hash','initial_password_hash','status','expires_at',
      'accepted_at','revoked_at','revoked_by_user_id','revoke_reason',
      'created_at','updated_at',
    ]));
  });

  it('partial unique constraint on (email) WHERE status=pending exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes WHERE indexname='user_invitations_email_active_unique'`);
    expect(r.rowCount).toBe(1);
  });

  it('users.must_change_password column exists with default false', async () => {
    const r = await pool.query(`
      SELECT is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name='users' AND column_name='must_change_password'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].is_nullable).toBe('NO');
    expect(r.rows[0].column_default).toMatch(/false/i);
  });

  it('user_invitations_token_idx index exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes WHERE indexname='user_invitations_token_idx'`);
    expect(r.rowCount).toBe(1);
  });
});

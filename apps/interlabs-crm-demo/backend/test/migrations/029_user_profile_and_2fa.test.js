'use strict';
const { pool } = require('../helpers/db');

describe('migration 029 user profile and 2fa', () => {
    it('users has 7 new columns', async () => {
        const r = await pool.query(`
            SELECT column_name FROM information_schema.columns
             WHERE table_name='users'
               AND column_name IN (
                   'first_name','last_name','phone',
                   'two_factor_method','two_factor_secret',
                   'two_factor_backup_codes','two_factor_enabled_at'
               )`);
        expect(r.rowCount).toBe(7);
    });

    it('two_factor_method has default disabled and is NOT NULL', async () => {
        const r = await pool.query(`
            SELECT column_default, is_nullable, data_type
              FROM information_schema.columns
             WHERE table_name='users' AND column_name='two_factor_method'`);
        expect(r.rowCount).toBe(1);
        expect(r.rows[0].is_nullable).toBe('NO');
        expect(r.rows[0].column_default).toMatch(/disabled/);
    });

    it('two_factor_method CHECK accepts only the 3 valid values', async () => {
        const r = await pool.query(`
            SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
             WHERE conname='users_two_factor_method_chk'`);
        expect(r.rowCount).toBe(1);
        expect(r.rows[0].def).toMatch(/disabled/);
        expect(r.rows[0].def).toMatch(/email/);
        expect(r.rows[0].def).toMatch(/totp/);
    });

    it('phone E.164 CHECK constraint exists', async () => {
        const r = await pool.query(`
            SELECT 1 FROM pg_constraint WHERE conname='users_phone_e164_chk'`);
        expect(r.rowCount).toBe(1);
    });

    it('partial index on two_factor_method (active only) exists', async () => {
        const r = await pool.query(`
            SELECT 1 FROM pg_indexes WHERE indexname='users_2fa_method_idx'`);
        expect(r.rowCount).toBe(1);
    });

    it('password_reset_tokens table exists with expected columns', async () => {
        const t = await pool.query(`
            SELECT 1 FROM information_schema.tables WHERE table_name='password_reset_tokens'`);
        expect(t.rowCount).toBe(1);
        const cols = await pool.query(`
            SELECT column_name FROM information_schema.columns
             WHERE table_name='password_reset_tokens'`);
        const set = cols.rows.map(c => c.column_name);
        expect(set).toEqual(expect.arrayContaining([
            'id','user_id','token_hash','expires_at','used_at','requested_ip','created_at',
        ]));
    });

    it('password_reset_tokens.token_hash is UNIQUE', async () => {
        const r = await pool.query(`
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'password_reset_tokens'::regclass
               AND contype = 'u'
               AND pg_get_constraintdef(oid) LIKE '%token_hash%'`);
        expect(r.rowCount).toBe(1);
    });

    it('password_reset_tokens active partial index exists', async () => {
        const r = await pool.query(`
            SELECT 1 FROM pg_indexes WHERE indexname='password_reset_tokens_active_idx'`);
        expect(r.rowCount).toBe(1);
    });

    it('two_factor_email_codes table exists with expected columns', async () => {
        const t = await pool.query(`
            SELECT 1 FROM information_schema.tables WHERE table_name='two_factor_email_codes'`);
        expect(t.rowCount).toBe(1);
        const cols = await pool.query(`
            SELECT column_name FROM information_schema.columns
             WHERE table_name='two_factor_email_codes'`);
        const set = cols.rows.map(c => c.column_name);
        expect(set).toEqual(expect.arrayContaining([
            'id','user_id','code_hash','expires_at','used_at','attempts','created_at',
        ]));
    });

    it('two_factor_email_codes user+created_at composite index exists', async () => {
        const r = await pool.query(`
            SELECT 1 FROM pg_indexes WHERE indexname='two_factor_email_codes_user_idx'`);
        expect(r.rowCount).toBe(1);
    });

    it('phone E.164 constraint actually rejects bad format', async () => {
        // Pick any user; try update with a non-E.164 phone — must fail.
        const u = await pool.query(`SELECT id FROM users LIMIT 1`);
        if (!u.rowCount) return;
        await expect(
            pool.query(`UPDATE users SET phone='not-a-phone' WHERE id=$1`, [u.rows[0].id]),
        ).rejects.toThrow(/users_phone_e164_chk|check constraint/i);
        // Restore (clean up — leave phone NULL for this user)
        await pool.query(`UPDATE users SET phone=NULL WHERE id=$1`, [u.rows[0].id]);
    });

    it('phone E.164 constraint accepts valid format', async () => {
        const u = await pool.query(`SELECT id FROM users LIMIT 1`);
        if (!u.rowCount) return;
        await pool.query(`UPDATE users SET phone='+628123456789' WHERE id=$1`, [u.rows[0].id]);
        const r = await pool.query(`SELECT phone FROM users WHERE id=$1`, [u.rows[0].id]);
        expect(r.rows[0].phone).toBe('+628123456789');
        await pool.query(`UPDATE users SET phone=NULL WHERE id=$1`, [u.rows[0].id]);
    });
});

'use strict';
const { pool } = require('../helpers/db');

describe('migrations 023+024 notification senders + extras', () => {
  it('notification_senders table with provider CHECK', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_senders'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='notification_senders_provider_chk'`);
    expect(c.rows[0]?.def).toMatch(/smtp|gmail|ses|postmark|resend/i);
  });

  it('notification_templates.sender_id column added', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='notification_templates' AND column_name='sender_id'`);
    expect(r.rowCount).toBe(1);
  });

  it('notification_template_extra_recipients table exists with unique constraint', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_template_extra_recipients'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='notification_template_extra_recipients_unique'`);
    expect(c.rowCount).toBe(1);
  });

  it('notification_user_mutes table exists with unique constraint', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_user_mutes'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='notification_user_mutes_unique'`);
    expect(c.rowCount).toBe(1);
  });
});

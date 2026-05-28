'use strict';
const { pool } = require('../helpers/db');

describe('seed — notification sender + capability', () => {
  it('default noreply sender exists', async () => {
    const r = await pool.query(`SELECT provider, is_active FROM notification_senders WHERE sender_key='noreply'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].provider).toBe('smtp');
    expect(r.rows[0].is_active).toBe(true);
  });

  it('all existing notification_templates have sender_id assigned', async () => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM notification_templates WHERE sender_id IS NULL`);
    expect(r.rows[0].n).toBe(0);
  });

  it('manage_notifications capability exists', async () => {
    const r = await pool.query(`SELECT 1 FROM capability_definitions WHERE capability_key='manage_notifications'`);
    expect(r.rowCount).toBe(1);
  });
});

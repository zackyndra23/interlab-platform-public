'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/activity_log.service');
describe('onlineUsers enrichment', () => {
  it('returns last_login_at + is_online + online_since fields', async () => {
    await pool.query(`UPDATE users SET last_login_at = now() WHERE role='superadmin'`);
    const rows = await svc.onlineUsers();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0); // recently-active users included even with no live WS
    expect(rows[0]).toHaveProperty('last_login_at');
    expect(rows[0]).toHaveProperty('is_online');
    expect(rows[0]).toHaveProperty('online_since');
  });
});

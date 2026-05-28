'use strict';
const { pool } = require('../helpers/db');

describe('seed — invitation prerequisites', () => {
  it('invite_user capability exists', async () => {
    const r = await pool.query(`SELECT 1 FROM capability_definitions WHERE capability_key='invite_user'`);
    expect(r.rowCount).toBe(1);
  });

  it('invitation_pending template exists and is enabled', async () => {
    const r = await pool.query(`SELECT status FROM notification_templates WHERE template_key='invitation_pending'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].status).toBe('enabled');
  });

  it('top-rank manager of each invitable role has invite_user on admin_rbac', async () => {
    const r = await pool.query(`
      SELECT r.role_key, count(*)::int AS n
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        JOIN role_levels rl ON rl.id = rp.level_id
        JOIN feature_definitions f ON f.id = rp.feature_id
        JOIN capability_definitions c ON c.id = rp.capability_id
       WHERE f.feature_key = 'admin_rbac'
         AND c.capability_key = 'invite_user'
         AND rl.level_rank = (SELECT max(level_rank) FROM role_levels
                                 WHERE role_id = rl.role_id AND deleted_at IS NULL)
       GROUP BY r.role_key`);
    const keys = r.rows.map(x => x.role_key).sort();
    expect(keys).toEqual(['admin_log','finance','hrga','sales','tax_insurance','technical']);
  });
});

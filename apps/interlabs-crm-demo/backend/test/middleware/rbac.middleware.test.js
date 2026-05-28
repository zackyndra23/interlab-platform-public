'use strict';
const { pool } = require('../helpers/db');
const { rbacGuard } = require('../../src/middleware/rbac.middleware');

let superadminId, salesStaffId;

beforeAll(async () => {
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('superadmin','sales') AND deleted_at IS NULL`);
  superadminId = u.rows.find(x => x.role === 'superadmin')?.id;
  const s = await pool.query(`
    SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND rl.level_rank=1 AND u.deleted_at IS NULL LIMIT 1`);
  salesStaffId = s.rows[0]?.id;
});

function makeMock(user) {
  const calls = [];
  const next = (err) => calls.push(err);
  return { req: { user }, res: {}, next, calls };
}

describe('rbacGuard', () => {
  it('rejects when no user attached', async () => {
    const guard = rbacGuard('sales_po', 'view_global');
    const m = makeMock(null);
    await guard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeInstanceOf(Error);
    expect(m.calls[0].message).toMatch(/authenticated/i);
  });

  it('passes Superadmin via bypass', async () => {
    if (!superadminId) return;
    const guard = rbacGuard('sales_po', 'view_global');
    const m = makeMock({ id: superadminId, role: 'superadmin' });
    await guard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeUndefined();
    expect(m.req.capabilities).toBeDefined();
    expect(m.req.dataScope.scope).toBe('global');
    expect(m.req.roleScope).toBeDefined();
  });

  it('rejects user lacking capability on a feature', async () => {
    if (!salesStaffId) return;
    const guard = rbacGuard('nonexistent_feature_xyz', 'approve');
    const m = makeMock({ id: salesStaffId, role: 'sales' });
    await guard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeInstanceOf(Error);
  });

  it('attaches dataScope and capabilities on success path', async () => {
    if (!salesStaffId) return;
    // Find a capability the staff DOES have on sales_po
    const r = await pool.query(`
      SELECT c.capability_key
        FROM role_permissions rp
        JOIN role_levels rl ON rl.id=rp.level_id
        JOIN feature_definitions f ON f.id=rp.feature_id
        JOIN capability_definitions c ON c.id=rp.capability_id
       WHERE rp.role_id = (SELECT id FROM roles WHERE role_key='sales')
         AND rl.level_rank=1
         AND f.feature_key='sales_po'
       LIMIT 1`);
    if (!r.rowCount) return; // no permissions for staff on sales_po — skip
    const capKey = r.rows[0].capability_key;
    const guard = rbacGuard('sales_po', capKey);
    const m = makeMock({ id: salesStaffId, role: 'sales' });
    await guard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeUndefined();
    expect(m.req.capabilities.has(capKey)).toBe(true);
    expect(m.req.dataScope).toBeDefined();
    expect(m.req.roleScope).toBeDefined();
  });
});

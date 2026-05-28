'use strict';
const { pool } = require('../helpers/db');
const { sameRoleScopeGuard } = require('../../src/middleware/sameRoleScope.middleware');

let superadminId, salesStaffId;
let mgrFixtureId; // a sales manager-rank fixture user we may need to create

beforeAll(async () => {
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('superadmin','sales') AND deleted_at IS NULL`);
  superadminId = u.rows.find(x => x.role === 'superadmin')?.id;
  const s = await pool.query(`
    SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND rl.level_rank=1 AND u.deleted_at IS NULL LIMIT 1`);
  salesStaffId = s.rows[0]?.id;

  // Create a Sales Manager-rank fixture (level_rank=2) since seed may only create Staff
  const mgrLvl = await pool.query(`
    SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id
     WHERE r.role_key='sales' AND rl.level_rank=2 LIMIT 1`);
  if (mgrLvl.rowCount) {
    const ins = await pool.query(`
      INSERT INTO users (email, password_hash, role, display_name, level_id, account_status)
      VALUES ($1, 'fixture', 'sales', 'Test Sales Manager', $2, 'active')
      ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
      RETURNING id`, ['fixture-sales-manager@test.local', mgrLvl.rows[0].id]);
    mgrFixtureId = ins.rows[0].id;
  }
});

afterAll(async () => {
  // Clean up the fixture user
  await pool.query(`DELETE FROM users WHERE email='fixture-sales-manager@test.local'`);
});

function mockReq(user, paramsId) {
  const calls = [];
  const next = (err) => calls.push(err);
  return { req: { user, params: { id: paramsId } }, res: {}, next, calls };
}

describe('sameRoleScopeGuard', () => {
  it('Superadmin bypass — passes through', async () => {
    if (!superadminId || !salesStaffId) return;
    const m = mockReq({ id: superadminId, role: 'superadmin' }, salesStaffId);
    await sameRoleScopeGuard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeUndefined();
  });

  it('Manager can edit Staff in same role', async () => {
    if (!mgrFixtureId || !salesStaffId) return;
    const m = mockReq({ id: mgrFixtureId, role: 'sales' }, salesStaffId);
    await sameRoleScopeGuard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeUndefined();
  });

  it('Staff cannot edit Manager in same role', async () => {
    if (!mgrFixtureId || !salesStaffId) return;
    const m = mockReq({ id: salesStaffId, role: 'sales' }, mgrFixtureId);
    await sameRoleScopeGuard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeInstanceOf(Error);
    expect(m.calls[0].message).toMatch(/same-\s*or\s*higher-rank|forbidden/i);
  });

  it('rejects cross-role management', async () => {
    if (!mgrFixtureId) return;
    // create a Finance staff fixture
    const fl = await pool.query(`
      SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id
       WHERE r.role_key='finance' AND rl.level_rank=1 LIMIT 1`);
    if (!fl.rowCount) return;
    const ins = await pool.query(`
      INSERT INTO users (email, password_hash, role, display_name, level_id, account_status)
      VALUES ($1, 'fixture', 'finance', 'Test Finance Staff', $2, 'active')
      ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
      RETURNING id`, ['fixture-finance-staff@test.local', fl.rows[0].id]);
    const financeId = ins.rows[0].id;
    try {
      const m = mockReq({ id: mgrFixtureId, role: 'sales' }, financeId);
      await sameRoleScopeGuard(m.req, m.res, m.next);
      expect(m.calls[0]).toBeInstanceOf(Error);
      expect(m.calls[0].message).toMatch(/cross-role/i);
    } finally {
      await pool.query(`DELETE FROM users WHERE id=$1`, [financeId]);
    }
  });

  it('rejects when no user authenticated', async () => {
    const m = mockReq(null, salesStaffId);
    await sameRoleScopeGuard(m.req, m.res, m.next);
    expect(m.calls[0]).toBeInstanceOf(Error);
    expect(m.calls[0].message).toMatch(/authenticated/i);
  });
});

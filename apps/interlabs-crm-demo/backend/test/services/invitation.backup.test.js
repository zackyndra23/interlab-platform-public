'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/invitation.service');

let ceoId;
const createdUserIds = [];

beforeAll(async () => {
  const u = await pool.query(`SELECT id FROM users WHERE role = 'ceo' LIMIT 1`);
  ceoId = u.rows[0]?.id;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
  }
  await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'invite-backup-%@test.local'`);
});

describe('invitation.accept — backup password', () => {
  it('copies the invitation initial_password_hash into users.backup_password_hash', async () => {
    if (!ceoId) return;
    const created = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-backup-1@test.local',
      roleKey: 'sales',
    });
    const inv = await pool.query(
      `SELECT initial_password_hash FROM user_invitations WHERE id = $1`, [created.invitationId]);
    const accepted = await svc.accept({ token: created.activationToken, displayName: 'Backup Test' });
    createdUserIds.push(accepted.userId);

    const u = await pool.query(
      `SELECT password_hash, backup_password_hash FROM users WHERE id = $1`, [accepted.userId]);
    expect(u.rows[0].backup_password_hash).toBe(inv.rows[0].initial_password_hash);
    expect(u.rows[0].password_hash).toBe(inv.rows[0].initial_password_hash);
  });
});

describe('invitation manager scope (service authorizeInvite)', () => {
  let salesMgrId;
  beforeAll(async () => {
    const r = await pool.query(`
      SELECT u.id FROM users u
        JOIN role_levels rl ON rl.id = u.level_id
       WHERE u.role = 'sales' AND rl.level_rank = 2 AND u.deleted_at IS NULL
       LIMIT 1`);
    salesMgrId = r.rows[0]?.id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'mgr-scope-%@test.local'`);
  });

  it('a sales manager can invite into role sales', async () => {
    if (!salesMgrId) return;
    const r = await svc.create({
      actor: { id: salesMgrId, role: 'sales' },
      email: 'mgr-scope-1@test.local',
      roleKey: 'sales',
    });
    expect(r.invitationId).toBeDefined();
  });

  it('a sales manager cannot invite into another role', async () => {
    if (!salesMgrId) return;
    await expect(
      svc.create({ actor: { id: salesMgrId, role: 'sales' }, email: 'mgr-scope-2@test.local', roleKey: 'finance' }),
    ).rejects.toThrow(/own role/i);
  });
});

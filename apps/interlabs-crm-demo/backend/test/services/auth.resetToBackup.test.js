'use strict';
const { pool } = require('../helpers/db');
const bcrypt = require('bcryptjs');
const svc = require('../../src/services/auth.service');

let superId;
let targetId;

beforeAll(async () => {
  const s = await pool.query(`SELECT id, email, role FROM users WHERE role = 'superadmin' LIMIT 1`);
  superId = s.rows[0];
  if (!superId) throw new Error('No superadmin seed row — run scripts/seed.js against the test DB');
  const backup = await bcrypt.hash('Backup#Known1', 10);
  const ins = await pool.query(
    `INSERT INTO users (email, password_hash, backup_password_hash, role, display_name, account_status, must_change_password)
     VALUES ('reset-target@test.local', $1, $2, 'sales', 'Reset Target', 'active', false)
     ON CONFLICT (email) DO UPDATE SET password_hash=$1, backup_password_hash=$2, must_change_password=false, deleted_at=NULL
     RETURNING id`,
    [await bcrypt.hash('Original#Pw1', 10), backup]);
  targetId = ins.rows[0].id;
});

afterAll(async () => {
  if (targetId) await pool.query(`DELETE FROM users WHERE id = $1`, [targetId]);
  if (targetId) await pool.query(`DELETE FROM activity_logs WHERE resource_id = $1`, [targetId]);
});

describe('auth.resetToBackup', () => {
  it('copies backup_password_hash into password_hash, sets must_change_password, logs the action', async () => {
    const backupRow = await pool.query(`SELECT backup_password_hash FROM users WHERE id=$1`, [targetId]);
    const res = await svc.resetToBackup({
      actor: { id: superId.id, email: superId.email, role: superId.role },
      targetUserId: targetId,
    });
    expect(res.ok).toBe(true);

    const u = await pool.query(`SELECT password_hash, must_change_password FROM users WHERE id=$1`, [targetId]);
    expect(u.rows[0].password_hash).toBe(backupRow.rows[0].backup_password_hash);
    expect(u.rows[0].must_change_password).toBe(true);

    const log = await pool.query(
      `SELECT 1 FROM activity_logs WHERE action='auth.password.reset_to_backup' AND resource_id=$1`, [targetId]);
    expect(log.rowCount).toBeGreaterThan(0);
  });

  it('throws when the target has no backup_password_hash', async () => {
    await pool.query(`UPDATE users SET backup_password_hash = NULL WHERE id = $1`, [targetId]);
    await expect(
      svc.resetToBackup({ actor: { id: superId.id, email: superId.email, role: superId.role }, targetUserId: targetId }),
    ).rejects.toThrow(/backup password/i);
  });
});

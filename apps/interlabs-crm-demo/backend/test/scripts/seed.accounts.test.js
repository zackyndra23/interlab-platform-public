'use strict';
const { pool } = require('../helpers/db');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runSeed() {
  const r = spawnSync('node', ['scripts/seed.js'], {
    cwd: path.resolve(__dirname, '../..'), stdio: 'pipe', env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`seed exited ${r.status}: ${r.stderr?.toString() || r.stdout?.toString()}`);
  }
}

// mirrors USERS in scripts/seed.js — keep in sync
const EXPECTED = {
  'zakyindrasatriaputra@gmail.com': 'superadmin',
  'zakyindrasatriap@gmail.com': 'ceo',
  'putra.zakyindras@gmail.com': 'sales',
  'adminlog@issi-interlab.com': 'admin_log',
  'zaky.putra@integrity-indonesia.com': 'finance',
  'pancaaindrawati@gmail.com': 'technical',
  'pancaindrawati27@gmail.com': 'hrga',
  'pancaindrawati2704@gmail.com': 'tax_insurance',
};
const EMAILS = Object.keys(EXPECTED);

describe('seed — account remap', () => {
  beforeAll(() => runSeed());

  it('seeds the 8 real accounts with correct roles', async () => {
    const r = await pool.query(`SELECT email, role FROM users WHERE email = ANY($1)`, [EMAILS]);
    expect(Object.fromEntries(r.rows.map((x) => [x.email, x.role]))).toEqual(EXPECTED);
  });

  it('division accounts are managers (rank-2); superadmin/ceo have no level', async () => {
    const r = await pool.query(`
      SELECT u.email, rl.level_rank
        FROM users u LEFT JOIN role_levels rl ON rl.id = u.level_id
       WHERE u.email = ANY($1)`, [EMAILS]);
    const byEmail = Object.fromEntries(r.rows.map((x) => [x.email, x.level_rank]));
    expect(byEmail['zakyindrasatriaputra@gmail.com']).toBeNull(); // superadmin
    expect(byEmail['zakyindrasatriap@gmail.com']).toBeNull();     // ceo
    const divisionEmails = EMAILS.filter(
      (e) => e !== 'zakyindrasatriaputra@gmail.com' && e !== 'zakyindrasatriap@gmail.com',
    );
    for (const e of divisionEmails) expect(byEmail[e]).toBe(2);
  });

  it('every seeded account has a backup_password_hash', async () => {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE email = ANY($1) AND backup_password_hash IS NOT NULL`,
      [EMAILS]);
    expect(r.rows[0].n).toBe(8);
  });

  it('hrga and tax do NOT have advance_stage on sales_po; the four PO roles do', async () => {
    const r = await pool.query(`
      SELECT DISTINCT r.role_key
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        JOIN feature_definitions f ON f.id = rp.feature_id
        JOIN capability_definitions c ON c.id = rp.capability_id
       WHERE f.feature_key = 'sales_po' AND c.capability_key = 'advance_stage'`);
    const roles = r.rows.map((x) => x.role_key);
    expect(roles).not.toContain('hrga');
    expect(roles).not.toContain('tax_insurance');
    expect(roles.slice().sort()).toEqual(['admin_log', 'finance', 'sales', 'technical']);
  });

  it('registers the reset_user_password capability', async () => {
    const r = await pool.query(
      `SELECT 1 FROM capability_definitions WHERE capability_key = 'reset_user_password'`);
    expect(r.rowCount).toBe(1);
  });
});

'use strict';
const db = require('../../src/config/database');
const bcrypt = require('bcryptjs'); // match scripts/seed.js
const DEMO_PW = process.env.DEMO_PASSWORD || 'Demo@22April2026!';
// division key (for email) → role_key
const DIVS = [
  ['sales', 'sales'], ['admin_log', 'admin_log'], ['finance', 'finance'],
  ['technical', 'technical'], ['hrga', 'hrga'], ['tax', 'tax_insurance'],
];

async function seedUsers(manifest) {
  const hash = bcrypt.hashSync(DEMO_PW, 10);
  await db.withTransaction(async (client) => {
    for (const [div, roleKey] of DIVS) {
      const email = `staff.${div}.demo@interlab-portal.com`;
      const name = `${div.replace('_', ' ')} Staff (Demo)`;
      const ins = await client.query(
        `INSERT INTO users (email, password_hash, backup_password_hash, role, display_name, account_status)
         VALUES ($1,$2,$2,$3,$4,'active') RETURNING id`,
        [email, hash, roleKey, name]);
      const uid = ins.rows[0].id;
      await client.query(
        `UPDATE users SET level_id = rl.id
           FROM roles r JOIN role_levels rl ON rl.role_id = r.id AND rl.level_rank = 1
          WHERE users.id = $1 AND r.role_key = $2`,
        [uid, roleKey]);
      manifest.demoUserIds.push(uid);
    }
    // realistic recent last_login for every active user (real + demo)
    await client.query(
      `UPDATE users SET last_login_at = now() - (random() * interval '5 days') WHERE account_status='active'`);
  });
}
module.exports = { seedUsers };

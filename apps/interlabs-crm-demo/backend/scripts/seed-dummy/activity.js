'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const ACTIONS = ['auth.login.success','logout','created','edit','archived','export'];
const RES = ['purchase_order','quotation','invoice_customer','legal_document','tax_record','company_letter'];

async function seedActivity(manifest) {
  await db.withTransaction(async (client) => {
    const users = await client.query(`SELECT id, email, role FROM users WHERE account_status='active' ORDER BY created_at`);
    for (const u of users.rows) {
      const acts = L.spreadStatuses(ACTIONS, ACTIONS.length); // one of each action per user
      for (let i = 0; i < acts.length; i++) {
        await client.query(
          `INSERT INTO activity_logs (user_id, user_email, user_role, action, resource_type, resource_id, detail, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'{"seeded":true}'::jsonb, now()-($7||' days')::interval)`,
          [u.id, u.email, u.role, acts[i], RES[i % RES.length], `demo-${i}`, Math.floor(Math.random()*30)]);
      }
    }
  });
}
module.exports = { seedActivity };

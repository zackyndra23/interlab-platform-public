'use strict';
const db = require('../../src/config/database');
const L = require('./lib');
const ROLES = ['superadmin','ceo','sales','admin_log','finance','technical','hrga','tax_insurance'];
const DIV_ROLES = ['sales','admin_log','finance','technical','hrga','tax_insurance'];
const MSGS = [
  'Halo, mohon update progress PO-DEMO-2026-00012 ya.',
  'Sudah saya proses, dokumennya menyusul sore ini.',
  'Baik, tolong dikabari kalau sudah sampai tahap berikutnya.',
  'Invoice-nya sudah saya teruskan ke Finance untuk ditindaklanjuti.',
  'Noted, terima kasih atas follow-up-nya.',
  'Untuk PO ini ada kendala di Customs, sedang kami cek.',
];

async function seedChat(manifest) {
  await db.withTransaction(async (client) => {
    const ur = await client.query(`SELECT id, role, email FROM users WHERE account_status='active'`);
    const real = {}, demo = {};
    for (const u of ur.rows) {
      if (/^staff\..*\.demo@/.test(u.email)) demo[u.role] = u;
      else if (!real[u.role]) real[u.role] = u;
    }
    const pairs = L.buildDmPlan(ROLES).map(([a, b]) => [real[a], real[b]]);
    for (const r of DIV_ROLES) if (real[r] && demo[r]) pairs.push([real[r], demo[r]]);

    let pi = 0;
    for (const [ua, ub] of pairs) {
      if (!ua || !ub) continue;
      pi++;
      const ch = await client.query(
        `INSERT INTO chat_channels (channel_type, channel_name, created_by, created_at)
         VALUES ('dm', $1, $2, now()-($3||' days')::interval) RETURNING id`,
        [`DEMO DM: ${ua.role}-${ub.role}-${pi}`, ua.id, pi]);
      const chId = ch.rows[0].id;
      manifest.chatChannelIds.push(chId);
      for (const u of [ua, ub])
        await client.query(`INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chId, u.id]);
      const members = [ua, ub];
      for (let m = 0; m < 6; m++) {
        const sender = members[m % 2];
        const msg = await client.query(
          `INSERT INTO chat_messages (channel_id, sender_user_id, content, created_at)
           VALUES ($1,$2,$3, now()-($4||' days')::interval + ($5||' minutes')::interval) RETURNING id`,
          [chId, sender.id, MSGS[m % MSGS.length], pi, m * 7]);
        if (m % 2 === 0) {
          const reader = members[(m + 1) % 2];
          await client.query(`INSERT INTO chat_message_reads (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [msg.rows[0].id, reader.id]);
        }
      }
    }
  });
}
module.exports = { seedChat };

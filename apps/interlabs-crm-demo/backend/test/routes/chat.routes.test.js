'use strict';
const request = require('supertest');
const { pool } = require('../helpers/db');
const app = require('../../src/app');
const authSvc = require('../../src/services/auth.service');

let uA, uB, uC, chId, tokenA, tokenC;
beforeAll(async () => {
  const mk = async (email, role) => (await pool.query(
    `INSERT INTO users (email,password_hash,role,display_name,account_status)
     VALUES ($1,'$2a$12$x',$2,$3,'active') ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role RETURNING id,email,role,display_name`,
    [email, role, email.split('@')[0]])).rows[0];
  uA = await mk('chat-a@test.local','sales'); uB = await mk('chat-b@test.local','finance'); uC = await mk('chat-c@test.local','technical');
  tokenA = authSvc.signAccessToken({ id:uA.id, email:uA.email, role:uA.role, display_name:uA.display_name });
  tokenC = authSvc.signAccessToken({ id:uC.id, email:uC.email, role:uC.role, display_name:uC.display_name });
  const ch = await pool.query(`INSERT INTO chat_channels (channel_type, channel_name) VALUES ('dm','CHTEST') RETURNING id`);
  chId = ch.rows[0].id;
  await pool.query(`INSERT INTO chat_channel_members (channel_id,user_id) VALUES ($1,$2),($1,$3)`, [chId, uA.id, uB.id]);
  await pool.query(`INSERT INTO chat_messages (channel_id, sender_user_id, content) VALUES ($1,$2,'halo'),($1,$3,'oke')`, [chId, uA.id, uB.id]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM chat_messages WHERE channel_id=$1`, [chId]);
  await pool.query(`DELETE FROM chat_channel_members WHERE channel_id=$1`, [chId]);
  await pool.query(`DELETE FROM chat_channels WHERE id=$1`, [chId]);
  await pool.query(`DELETE FROM users WHERE email IN ('chat-a@test.local','chat-b@test.local','chat-c@test.local')`);
});
describe('chat routes', () => {
  it('GET /api/chat/channels → array incl. the DM with mapped shape', async () => {
    const r = await request(app).get('/api/chat/channels').set('Authorization', `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    const c = r.body.data.find(x => x.id === chId);
    expect(c).toBeTruthy();
    expect(c.channel_type).toBe('direct');
    expect(c.title).toBe(uB.display_name);
    expect(typeof c.member_count).toBe('number');
  });
  it('GET messages → array for member', async () => {
    const r = await request(app).get(`/api/chat/channels/${chId}/messages`).set('Authorization', `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data.length).toBeGreaterThanOrEqual(2);
    expect(r.body.data[0]).toHaveProperty('sender_name');
  });
  it('GET messages → 403 for non-member', async () => {
    const r = await request(app).get(`/api/chat/channels/${chId}/messages`).set('Authorization', `Bearer ${tokenC}`);
    expect(r.status).toBe(403);
  });
  it('POST message → inserts + returns object', async () => {
    const r = await request(app).post(`/api/chat/channels/${chId}/messages`).set('Authorization', `Bearer ${tokenA}`).send({ content: 'tes kirim' });
    expect(r.status).toBe(200);
    expect(r.body.data.content).toBe('tes kirim');
    expect(r.body.data.sender_user_id).toBe(uA.id);
  });
});

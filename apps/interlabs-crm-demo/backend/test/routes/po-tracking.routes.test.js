'use strict';
const request = require('supertest');
const { pool } = require('../helpers/db');
const app = require('../../src/app');
const authSvc = require('../../src/services/auth.service');
let token, poId, poNum = 'PO-TRK-TEST-1', uid;
beforeAll(async () => {
  const u = await pool.query(`INSERT INTO users (email,password_hash,role,display_name,account_status) VALUES ('trk@test.local','$2a$12$x','superadmin','Trk Admin','active') ON CONFLICT (email) DO UPDATE SET role='superadmin' RETURNING id,email,role,display_name`);
  uid = u.rows[0].id; token = authSvc.signAccessToken({ id:uid, email:u.rows[0].email, role:'superadmin', display_name:'Trk Admin' });
  const po = await pool.query(`INSERT INTO purchase_orders (po_number, current_status) VALUES ($1,'Processed') RETURNING id`, [poNum]);
  poId = po.rows[0].id;
  await pool.query(`INSERT INTO purchase_order_status_history (po_id,po_number,status_code,status_label,updated_by_user_id,updated_by_role,created_at)
    VALUES ($1,$2,'REGISTERED','Registered',$3,'sales', now()-interval '2 days'),($1,$2,'PROCESSED','Processed',$3,'sales', now()-interval '1 day')`, [poId, poNum, uid]);
});
afterAll(async () => { await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [poId]); await pool.query(`DELETE FROM users WHERE email='trk@test.local'`); });
describe('po-tracking routes', () => {
  it('GET /api/po-tracking → array+meta incl. the PO', async () => {
    const r = await request(app).get('/api/po-tracking?search=PO-TRK-TEST').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200); expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.meta).toBeTruthy();
    expect(r.body.data.find(x => x.po_number === poNum)).toBeTruthy();
  });
  it('GET /:id/history → array oldest→newest with updated_by_name', async () => {
    const r = await request(app).get(`/api/po-tracking/${poId}/history`).set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data[0].status_label).toBe('Registered');
    expect(r.body.data[0]).toHaveProperty('updated_by_name');
  });
  it('GET /search → { po, history }', async () => {
    const r = await request(app).get(`/api/po-tracking/search?po_number=${poNum}`).set('Authorization', `Bearer ${token}`);
    expect(r.body.data.po.po_number).toBe(poNum);
    expect(Array.isArray(r.body.data.history)).toBe(true);
  });
});

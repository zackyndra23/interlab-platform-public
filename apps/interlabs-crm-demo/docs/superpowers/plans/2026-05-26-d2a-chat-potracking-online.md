# D2a — Chat / PO-Tracking / Online-Now (make-it-work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the chat page, PO-tracking page, and Online-Now panel actually work by adding the missing backend REST routes (matching the existing frontend types), varying PO status-history actor by stage owner, and surfacing `last_login_at` + online duration.

**Architecture:** Two new thin read/write routers (`/api/chat`, `/api/po-tracking`) that derive the frontend-expected shapes from existing tables (chat tables don't match the FE type — map in-query); a seeder data fix; and an online-now enhancement (track WS connect time). No schema migration needed.

**Tech Stack:** Node 20 CJS, raw `pg`, Express routers (`router.use(authMiddleware)` per file), vitest + supertest against `crmdemo_test`, MinIO skipped via `SEED_DUMMY_NO_FILES`.

---

## Conventions (read once)
- **Env** (from `backend/`): `export PATH="/home/zaky/.nvm/versions/node/v20.20.2/bin:$PATH"; PW=$(sudo grep -E "^interlab_staging01_password=" /root/.coolify-secrets-backup.txt | cut -d= -f2-); export DATABASE_URL="postgresql://interlab_staging01:${PW}@127.0.0.1:5440/crmdemo_test"`. Same for vitest. Ignore pre-existing env failures (redis/avatar/SMTP/permission).
- **Local per-task commits, NO push.** Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Route pattern** (mirror `notifications.routes.js`): `const express=require('express'); const router=express.Router(); const Joi=require('joi'); const {authMiddleware}=require('../middleware/auth.middleware'); const {validate}=require('../middleware/validator.middleware'); const db=require('../config/database'); const {success}=require('../utils/response'); const {buildMeta}=require('../utils/pagination'); router.use(authMiddleware);` … `module.exports=router;`. Handlers wrapped `try{...}catch(e){next(e);}`.
- **Envelope:** list endpoints consumed by `apiList` return `success(rowsArray)` or `success(rowsArray, meta)` (data IS the array); object endpoints return `success(obj)`. Do NOT wrap arrays in `{items}`.
- Mount new routers in `backend/src/app.js` BEFORE the `/api` 404 catch-all (~L84), e.g. `app.use('/api/chat', require('./routes/chat.routes'));`.

## Contract reference (frontend types the routes MUST satisfy)
- `ChatChannel`: `{ id, channel_key, channel_type:'role'|'direct'|'topic', title, description|null, role_scope|null, member_count, unread_count, last_message_preview|null, last_message_at|null, created_at }`. DB `chat_channels` has `channel_name, channel_type('role'|'dm'|'group'|'topic'), topic` → **map** `'dm'→'direct'`, `'group'→'topic'`; `title`= for DM the OTHER member's `display_name`, else `channel_name`; `channel_key`=`id`; `description`=`topic`; `role_scope`=null; counts computed.
- `ChatMessage`: `{ id, channel_id, topic_id|null, sender_user_id, sender_name|null, sender_avatar_url|null, content, created_at }` → JOIN `users` for `sender_name`(display_name)/`sender_avatar_url`(avatar_url).
- `PoTrackingRecord`: `{ id, po_number, current_status, customer_id|null, customer_name|null, created_by_user_id|null, created_by_role|null, due_at, overdue_at, overdue_reason, escalation_sent_at, created_at, updated_at }`.
- `PoStatusHistoryRow`: `{ id, po_id, po_number, status_code, status_label, updated_by_user_id|null, updated_by_role|null, updated_by_name|null, note|null, reason_if_delayed|null, attachment_url|null, created_at }`.
- `PoTrackingSearchResult`: `{ po: PoTrackingRecord, history: PoStatusHistoryRow[] }` (history = latest 3).
- Chat tables: `chat_channels(id,channel_name,channel_type,topic,created_at)`, `chat_channel_members(channel_id,user_id,last_read_message_id)` UNIQUE(channel_id,user_id), `chat_messages(id,channel_id,topic_id,sender_user_id,content,created_at)`. `users(display_name,avatar_url,role,last_login_at)`.

---

## Task 1: Chat REST routes

**Files:** Create `backend/src/routes/chat.routes.js`; Modify `backend/src/app.js`; Test `backend/test/routes/chat.routes.test.js`.

- [ ] **Step 1: failing test** — seed a DM channel with 2 members + 2 messages; assert (a) member gets channels array incl. that channel with `channel_type:'direct'`, `title`=peer name, `unread_count`≥0; (b) member gets messages array; (c) non-member gets 403 on messages; (d) POST inserts + returns the message object.
```javascript
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
    expect(c.title).toBe(uB.display_name); // peer name for A
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
```
- [ ] **Step 2:** `npx vitest run test/routes/chat.routes.test.js` → FAIL (404, route missing).
- [ ] **Step 3: implement `backend/src/routes/chat.routes.js`**
```javascript
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const db = require('../config/database');
const { success, error } = require('../utils/response');
let emitter; try { emitter = require('../websocket'); } catch (_) { emitter = null; }

router.use(authMiddleware);

async function isMember(channelId, userId) {
  const r = await db.query(`SELECT 1 FROM chat_channel_members WHERE channel_id=$1 AND user_id=$2`, [channelId, userId]);
  return r.rowCount > 0;
}

// GET /api/chat/channels — channels the user belongs to, mapped to ChatChannel
router.get('/channels', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const r = await db.query(`
      SELECT c.id, c.channel_name, c.channel_type, c.topic, c.created_at,
             (SELECT count(*)::int FROM chat_channel_members m2 WHERE m2.channel_id=c.id) AS member_count,
             (SELECT count(*)::int FROM chat_messages msg
                WHERE msg.channel_id=c.id AND msg.deleted_at IS NULL
                  AND (mem.last_read_message_id IS NULL OR msg.created_at >
                       (SELECT created_at FROM chat_messages WHERE id=mem.last_read_message_id))) AS unread_count,
             lm.content AS last_message_preview, lm.created_at AS last_message_at,
             peer.display_name AS peer_name
        FROM chat_channel_members mem
        JOIN chat_channels c ON c.id=mem.channel_id AND c.deleted_at IS NULL
        LEFT JOIN LATERAL (SELECT content, created_at FROM chat_messages WHERE channel_id=c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) lm ON true
        LEFT JOIN LATERAL (SELECT u.display_name FROM chat_channel_members m3 JOIN users u ON u.id=m3.user_id
                            WHERE m3.channel_id=c.id AND m3.user_id<>$1 LIMIT 1) peer ON true
       WHERE mem.user_id=$1
       ORDER BY lm.created_at DESC NULLS LAST, c.created_at DESC`, [uid]);
    const rows = r.rows.map((c) => ({
      id: c.id,
      channel_key: c.id,
      channel_type: c.channel_type === 'dm' ? 'direct' : c.channel_type === 'group' ? 'topic' : c.channel_type,
      title: c.channel_type === 'dm' ? (c.peer_name || 'Direct Message') : (c.channel_name || c.topic || 'Channel'),
      description: c.topic || null,
      role_scope: null,
      member_count: c.member_count,
      unread_count: c.unread_count,
      last_message_preview: c.last_message_preview || null,
      last_message_at: c.last_message_at || null,
      created_at: c.created_at,
    }));
    res.json(success(rows));
  } catch (e) { next(e); }
});

// GET /api/chat/channels/:id/messages — newest-first, member-gated
router.get('/channels/:id/messages',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }),
             query: Joi.object({ before: Joi.string().optional(), limit: Joi.number().integer().min(1).max(100).default(50) }) }),
  async (req, res, next) => {
    try {
      if (!(await isMember(req.params.id, req.user.id))) return res.status(403).json(error('Not a channel member', 'forbidden'));
      const limit = Number(req.query.limit) || 50;
      const params = [req.params.id];
      let beforeClause = '';
      if (req.query.before) { params.push(req.query.before); beforeClause = `AND m.created_at < (SELECT created_at FROM chat_messages WHERE id=$${params.length})`; }
      params.push(limit);
      const r = await db.query(`
        SELECT m.id, m.channel_id, m.topic_id, m.sender_user_id, m.content, m.created_at,
               u.display_name AS sender_name, u.avatar_url AS sender_avatar_url
          FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_user_id
         WHERE m.channel_id=$1 AND m.deleted_at IS NULL ${beforeClause}
         ORDER BY m.created_at DESC LIMIT $${params.length}`, params);
      res.json(success(r.rows));
    } catch (e) { next(e); }
  });

// POST /api/chat/channels/:id/messages — REST fallback send (member-gated)
router.post('/channels/:id/messages',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }),
             body: Joi.object({ content: Joi.string().min(1).max(5000).required(), topic_id: Joi.string().uuid().allow(null).optional() }) }),
  async (req, res, next) => {
    try {
      if (!(await isMember(req.params.id, req.user.id))) return res.status(403).json(error('Not a channel member', 'forbidden'));
      const ins = await db.query(
        `INSERT INTO chat_messages (channel_id, topic_id, sender_user_id, content)
         VALUES ($1,$2,$3,$4) RETURNING id, channel_id, topic_id, sender_user_id, content, created_at`,
        [req.params.id, req.body.topic_id || null, req.user.id, req.body.content]);
      const row = { ...ins.rows[0], sender_name: req.user.display_name || null, sender_avatar_url: null };
      // best-effort realtime fan-out to other members
      try {
        const others = await db.query(`SELECT user_id FROM chat_channel_members WHERE channel_id=$1 AND user_id<>$2`, [req.params.id, req.user.id]);
        if (emitter && emitter.sendToUsers) emitter.sendToUsers(others.rows.map(o => o.user_id), 'chat:message',
          { channel_id: row.channel_id, message_id: row.id, topic_id: row.topic_id, sender_id: row.sender_user_id, sender_name: row.sender_name, content: row.content, created_at: row.created_at });
      } catch (_) { /* WS optional */ }
      res.json(success(row));
    } catch (e) { next(e); }
  });

module.exports = router;
```
- [ ] **Step 4:** Mount in `app.js` (before the `/api` 404): `app.use('/api/chat', require('./routes/chat.routes'));`. Run the test → all pass.
- [ ] **Step 5: commit** `feat(d2a): chat REST routes (channels/messages/send) matching frontend ChatChannel/ChatMessage`

---

## Task 2: PO-Tracking REST routes

**Files:** Create `backend/src/routes/po-tracking.routes.js`; Modify `app.js`; Test `backend/test/routes/po-tracking.routes.test.js`.

- [ ] **Step 1: failing test** — insert a PO + 2 status-history rows; assert `GET /api/po-tracking` returns array+meta incl. the PO; `GET /api/po-tracking/:id/history` returns array oldest→newest with `updated_by_name`; `GET /api/po-tracking/search?po_number=` returns `{ po, history }`.
```javascript
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
```
- [ ] **Step 2:** run → FAIL (404).
- [ ] **Step 3: implement `backend/src/routes/po-tracking.routes.js`** (queries join customers + users; history joins users for `updated_by_name`):
```javascript
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const db = require('../config/database');
const { success, error } = require('../utils/response');
const { buildMeta } = require('../utils/pagination');
router.use(authMiddleware);

const PO_COLS = `p.id, p.po_number, p.current_status, p.customer_id, cu.company_name AS customer_name,
  p.created_by_user_id, p.created_by_role, p.due_at, p.overdue_at, p.overdue_reason, p.escalation_sent_at, p.created_at, p.updated_at`;
const HIST_COLS = `h.id, h.po_id, h.po_number, h.status_code, h.status_label, h.updated_by_user_id, h.updated_by_role,
  u.display_name AS updated_by_name, h.note, h.reason_if_delayed, h.attachment_url, h.created_at`;

router.get('/',
  validate({ query: Joi.object({ search: Joi.string().allow('').optional(), status: Joi.string().optional(),
             page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(25) }) }),
  async (req, res, next) => {
    try {
      const page = Number(req.query.page)||1, limit = Number(req.query.limit)||25, offset = (page-1)*limit;
      const where = ['p.deleted_at IS NULL']; const params = [];
      if (req.query.search) { params.push(`%${req.query.search}%`); where.push(`p.po_number ILIKE $${params.length}`); }
      if (req.query.status) { params.push(req.query.status); where.push(`p.current_status = $${params.length}`); }
      const total = (await db.query(`SELECT count(*)::int n FROM purchase_orders p WHERE ${where.join(' AND ')}`, params)).rows[0].n;
      params.push(limit); params.push(offset);
      const r = await db.query(`SELECT ${PO_COLS} FROM purchase_orders p LEFT JOIN customers cu ON cu.id=p.customer_id
        WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
      res.json(success(r.rows, buildMeta(total, page, limit)));
    } catch (e) { next(e); }
  });

router.get('/search',
  validate({ query: Joi.object({ po_number: Joi.string().required() }) }),
  async (req, res, next) => {
    try {
      const po = (await db.query(`SELECT ${PO_COLS} FROM purchase_orders p LEFT JOIN customers cu ON cu.id=p.customer_id
        WHERE p.po_number=$1 AND p.deleted_at IS NULL`, [req.query.po_number])).rows[0];
      if (!po) return res.status(404).json(error('PO not found', 'not_found'));
      const history = (await db.query(`SELECT ${HIST_COLS} FROM purchase_order_status_history h
        LEFT JOIN users u ON u.id=h.updated_by_user_id WHERE h.po_id=$1 ORDER BY h.created_at DESC LIMIT 3`, [po.id])).rows;
      res.json(success({ po, history }));
    } catch (e) { next(e); }
  });

router.get('/:id/history',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  async (req, res, next) => {
    try {
      const r = await db.query(`SELECT ${HIST_COLS} FROM purchase_order_status_history h
        LEFT JOIN users u ON u.id=h.updated_by_user_id WHERE h.po_id=$1 ORDER BY h.created_at ASC`, [req.params.id]);
      res.json(success(r.rows));
    } catch (e) { next(e); }
  });

module.exports = router;
```
- [ ] **Step 4:** Mount `app.use('/api/po-tracking', require('./routes/po-tracking.routes'));` (before 404). Run test → pass.
- [ ] **Step 5: commit** `feat(d2a): PO-tracking REST routes (list, search, full history with actor name)`

---

## Task 3: Actor-per-stage in seeder

**Files:** Modify `backend/scripts/seed-dummy/po.js`; Test: append to `backend/test/scripts/seed-dummy.integration.test.js`.

- [ ] **Step 1: failing assertion**
```javascript
  it('PO status history actors span the stage-owner roles (not all sales)', async () => {
    const r = await pool.query(`SELECT DISTINCT updated_by_role FROM purchase_order_status_history
      WHERE po_number LIKE 'PO-DEMO-%' AND updated_by_role IS NOT NULL`);
    const roles = r.rows.map(x => x.updated_by_role).sort();
    expect(roles).toEqual(expect.arrayContaining(['admin_log','finance','sales','technical']));
  });
```
- [ ] **Step 2:** run integration test → FAIL (only `sales`).
- [ ] **Step 3:** In `po.js`, add a stage→owner map + resolve one user per role once, and use the owner for each history/tracking row:
```javascript
const STAGE_OWNER = { Registered:'sales', Processed:'sales', Production:'finance', Shipped:'admin_log',
  Customs:'admin_log', Arrived:'admin_log', Inspected:'technical', Delivery:'admin_log',
  Installation:'technical', BAST:'technical', Invoice:'finance' };
```
In `seedPoFlow`, before the PO loop, build `const owners = {}; for (const role of ['sales','finance','admin_log','technical']) owners[role] = await pickActor(client, role);`. In the per-stage history+tracking inserts, replace `sales.id`/`'sales'` with `const o = owners[STAGE_OWNER[e.status]] || sales; … o.id, o.role`. (The `purchase_orders.created_by`/`updated_by` stays `sales` — only history/tracking actors vary.)
- [ ] **Step 4:** run integration test → pass.
- [ ] **Step 5: commit** `feat(d2a): vary PO status-history actor by stage owner (sales/finance/admin_log/technical)`

---

## Task 4: Online-Now last_login + connect time

**Files:** Modify `backend/src/websocket/state.js`, `backend/src/services/activity_log.service.js`, `backend/src/routes/activity_log.routes.js`; Test `backend/test/services/online_users.test.js`.

- [ ] **Step 1: failing test** — `onlineUsers()` returns rows including `last_login_at` and `is_online`/`online_since` keys for recently-active users.
```javascript
'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/activity_log.service');
it('onlineUsers returns last_login_at + is_online + online_since fields', async () => {
  await pool.query(`UPDATE users SET last_login_at = now() WHERE role='superadmin'`);
  const rows = await svc.onlineUsers();
  expect(Array.isArray(rows)).toBe(true);
  if (rows.length) { expect(rows[0]).toHaveProperty('last_login_at'); expect(rows[0]).toHaveProperty('is_online'); expect(rows[0]).toHaveProperty('online_since'); }
});
```
- [ ] **Step 2:** run → FAIL (keys missing).
- [ ] **Step 3:**
  - `state.js`: track connect time. Add `const connectedSince = new Map(); // userId → earliest Date`. In `registerConnection`, `if (!connectedSince.has(userId)) connectedSince.set(userId, new Date());`. In `unregisterConnection`, when the user's connection set becomes empty, `connectedSince.delete(userId)`. Export `getConnectedSince(userId)` → `connectedSince.get(userId) || null`. Update `reset()` to clear it.
  - `activity_log.service.onlineUsers()`: change to return **recently-active** users (online OR logged-in recently), e.g. `SELECT id, email, display_name, role, avatar_url, last_login_at FROM users WHERE account_status='active' AND (id = ANY($1) OR last_login_at IS NOT NULL) ORDER BY last_login_at DESC NULLS LAST LIMIT 50` with `$1 = wsState.getConnectedUserIds()`; map each row to add `is_online` (`connectedIds.includes(id)`), `online_since` (`wsState.getConnectedSince(id)`), `connections` (existing). Keep `record`/`list` exports.
- [ ] **Step 4:** run → pass; also confirm `GET /api/activity-logs/online` still returns the array (the route is unchanged — it just returns the richer rows).
- [ ] **Step 5: commit** `feat(d2a): online-now surfaces last_login + online_since (ws connect time)`

---

## Task 5: PO-Tracking page — browsable list + timeline (frontend)

**Files:** Modify `frontend/app/(app)/po-tracking/page.tsx` (+ add `poTrackingApi.list` in `frontend/lib/global-api.ts` + `PoTrackingListQuery` type). No FE test runner → manual verify.

- [ ] **Step 1:** Add to `global-api.ts` `poTrackingApi`: `list: (params) => apiList<PoTrackingRecord>('/api/po-tracking', params)`. Add `PoTrackingRecord` import.
- [ ] **Step 2:** In `po-tracking/page.tsx`, add a `DataTable` of all POs (columns: po_number, customer_name, po_type? (omit if not on record), current_status→`StatusBadge`, updated_at→`formatDate`) backed by `poTrackingApi.list({ page, limit, search, status })` with a search box + status `<select>`. Keep the existing exact-search → result panel. Clicking a row sets the selected PO and loads `poTrackingApi.fullHistory(id)` → renders the existing `PoTrackingTimeline`/`PoStageRail` (who/when per stage).
- [ ] **Step 3: manual verify** — `npm run build` (frontend) compiles; (live verify happens in Task 7). Commit:
```bash
git add apps/interlabs-crm-demo/frontend/app/\(app\)/po-tracking/page.tsx apps/interlabs-crm-demo/frontend/lib/global-api.ts apps/interlabs-crm-demo/frontend/lib/global-types.ts
git commit -m "feat(d2a): PO-tracking page browsable list + timeline drilldown"
```

> Note: chat page + Online-Now tab need NO frontend code changes for D2a (they already call the now-existing endpoints; the Online-Now tab already renders the rows — it just gains `last_login`/`online_since` data). If the Online-Now tab must show the new fields, add a small render tweak in `activity-logs/page.tsx` (last-seen text + online duration) as part of this task.

---

## Task 6: Full backend regression + commit gate
- [ ] Run the affected backend suite together (chat, po-tracking, online_users, seed-dummy integration, notifications regression): all green. Commit any test-only fixes.

## Task 7: Live verify (gated)
- [ ] Rebuild + restart `interlab-api` (new routes); `docker exec interlab-api node scripts/seed-dummy/index.js --reset` (applies actor-per-stage); rebuild `interlab-app` (po-tracking page change). 
- [ ] Verify via curl-in-container: `/api/chat/channels` (as a seeded user) returns array; `/api/po-tracking` returns POs; `/:id/history` has varied `updated_by_role`.
- [ ] **STOP — user logs in:** chat shows DM threads + history; PO Tracking lists all POs + timeline (who/when per stage); Online-Now shows last-login/duration. After confirmation → push + MR.

---

## Self-review notes (author)
- **Spec coverage:** §2 chat → T1; §3 po-tracking routes+page → T2,T5; §4 actor-per-stage → T3; §5 online-now → T4; testing → T1–T4,T6; live → T7. ✓
- **Shape contracts:** all list endpoints return `success(array)`/`success(array,meta)`; `/search` returns object; mapped chat shape (`'dm'→'direct'`, peer name as `title`); `updated_by_name` via JOIN. ✓
- **No `{items}`** wrappers. The legacy `/api/po/:id/history` is left untouched (frontend uses `/api/po-tracking/*`); not in scope.
- **Frontend** (T5) has no test runner → `npm run build` + live verify (T7).
- **Naming:** `isMember`, `onlineUsers`, `getConnectedSince`, `STAGE_OWNER`, `poTrackingApi.list` consistent.

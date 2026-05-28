'use strict';
// notifications.routes.test.js
// Regression guard: GET /api/notifications and related endpoints must use the
// is_read column (boolean), not read_at (which only exists on chat_message_reads).
// Covers: list, /all, /unread-count, /:id/read, /read-all
//
// Contract guard: the list endpoints (/ and /all) must return the rows as the
// envelope's `data` array (pagination in `meta`), matching every other list
// endpoint and the frontend `apiList` helper (which reads `data` as the array).
// Wrapping the array in `data.items` makes `apiList` hand the consumer an object,
// so `rows.map(...)` throws "x.map is not a function" and blanks the dashboard.

const request = require('supertest');
const { pool } = require('../helpers/db');

const app = require('../../src/app');

const FIXTURE_EMAIL = 'notifications-route-test@test.local';
let token;
let userId;
let notifId;

beforeAll(async () => {
    // Create a test user (sales role, level 1)
    const lvlRes = await pool.query(`
        SELECT rl.id FROM role_levels rl JOIN roles r ON r.id = rl.role_id
         WHERE r.role_key = 'sales' AND rl.level_rank = 1 LIMIT 1`);
    const levelId = lvlRes.rows[0]?.id;

    const userRes = await pool.query(`
        INSERT INTO users (email, password_hash, role, level_id, display_name, account_status)
        VALUES ($1, '$2a$12$testhashabcdefghijklmno', 'sales', $2, 'Notif Route Test', 'active')
        ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
        RETURNING id`,
        [FIXTURE_EMAIL, levelId]);
    userId = userRes.rows[0].id;

    // Issue a JWT directly (no password needed)
    const authSvc = require('../../src/services/auth.service');
    token = authSvc.signAccessToken({
        id: userId,
        email: FIXTURE_EMAIL,
        role: 'sales',
        display_name: 'Notif Route Test',
    });

    // Seed a test notification with is_read = false
    const notifRes = await pool.query(`
        INSERT INTO notifications (recipient_user_id, title, message, is_read)
        VALUES ($1, 'Test notification', 'Hello from test', false)
        RETURNING id`,
        [userId]);
    notifId = notifRes.rows[0].id;
});

afterAll(async () => {
    if (notifId) {
        await pool.query(`DELETE FROM notifications WHERE id = $1`, [notifId]);
    }
    await pool.query(`DELETE FROM users WHERE email = $1`, [FIXTURE_EMAIL]);
});

describe('GET /api/notifications', () => {
    it('returns 200 with the seeded notification (not 500)', async () => {
        const res = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeInstanceOf(Array);
        const item = res.body.data.find(n => n.id === notifId);
        expect(item).toBeDefined();
        expect(item.is_read).toBe(false);
        // Pagination metadata lives in `meta`, not wrapped into `data`.
        expect(res.body.meta).toBeDefined();
        expect(typeof res.body.meta.total).toBe('number');
    });

    it('returns 200 when unread_only=true and includes the unread notification', async () => {
        const res = await request(app)
            .get('/api/notifications?unread_only=true')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeInstanceOf(Array);
        const item = res.body.data.find(n => n.id === notifId);
        expect(item).toBeDefined();
    });
});

describe('GET /api/notifications/all', () => {
    it('returns 200 with data as an array (not 500, not wrapped in data.items)', async () => {
        const res = await request(app)
            .get('/api/notifications/all')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeInstanceOf(Array);
        const item = res.body.data.find(n => n.id === notifId);
        expect(item).toBeDefined();
        expect(item.is_read).toBe(false);
    });
});

describe('GET /api/notifications/unread-count', () => {
    it('returns 200 with a numeric count >= 1 (our seeded unread notification)', async () => {
        const res = await request(app)
            .get('/api/notifications/unread-count')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.data.count).toBe('number');
        expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    });
});

describe('POST /api/notifications/:id/read', () => {
    it('marks the notification read — is_read flips to true and unread-count decreases', async () => {
        // Get baseline unread count
        const countBefore = await request(app)
            .get('/api/notifications/unread-count')
            .set('Authorization', `Bearer ${token}`);
        const before = countBefore.body.data.count;

        // Mark as read
        const markRes = await request(app)
            .post(`/api/notifications/${notifId}/read`)
            .set('Authorization', `Bearer ${token}`);
        expect(markRes.status).toBe(200);
        expect(markRes.body.data.ok).toBe(true);

        // Verify in DB
        const dbRow = await pool.query(
            `SELECT is_read FROM notifications WHERE id = $1`, [notifId]);
        expect(dbRow.rows[0].is_read).toBe(true);

        // Unread count should have dropped by 1
        const countAfter = await request(app)
            .get('/api/notifications/unread-count')
            .set('Authorization', `Bearer ${token}`);
        expect(countAfter.body.data.count).toBe(before - 1);
    });
});

describe('PUT /api/notifications/read-all', () => {
    it('marks all remaining notifications read', async () => {
        // Reset: insert another unread notification to ensure there is something to mark
        const extraRes = await pool.query(`
            INSERT INTO notifications (recipient_user_id, title, message, is_read)
            VALUES ($1, 'Extra unread', null, false)
            RETURNING id`,
            [userId]);
        const extraId = extraRes.rows[0].id;

        const res = await request(app)
            .put('/api/notifications/read-all')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.data.updated).toBe('number');

        // Unread count should now be 0
        const countRes = await request(app)
            .get('/api/notifications/unread-count')
            .set('Authorization', `Bearer ${token}`);
        expect(countRes.body.data.count).toBe(0);

        // Clean up extra notification
        await pool.query(`DELETE FROM notifications WHERE id = $1`, [extraId]);
    });
});

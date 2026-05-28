'use strict';
// me-avatar.routes.test.js
// Verifies that GET /api/users/:id/avatar validates the id param as a UUID.
// A non-UUID id must return 400 (not 500 from Postgres uuid cast failure).

const request = require('supertest');
const { pool } = require('../../helpers/db');

// Build the app in minimal test mode — no scheduler, no cron.
const app = require('../../../src/app');

let token;
let userId;
const FIXTURE_EMAIL = 'avatar-route-test@test.local';

beforeAll(async () => {
    const lvl = await pool.query(`
        SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id
         WHERE r.role_key='sales' AND rl.level_rank=1 LIMIT 1`);
    const r = await pool.query(`
        INSERT INTO users (email, password_hash, role, level_id, display_name, account_status)
        VALUES ($1, '$2a$12$abc', 'sales', $2, 'Avatar Route Test', 'active')
        ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
        RETURNING id`,
        [FIXTURE_EMAIL, lvl.rows[0]?.id]);
    userId = r.rows[0].id;

    // Issue a JWT directly so we don't need a valid password
    const authSvc = require('../../../src/services/auth.service');
    token = authSvc.signAccessToken({
        id: userId,
        email: FIXTURE_EMAIL,
        role: 'sales',
        display_name: 'Avatar Route Test',
    });
});

afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email=$1`, [FIXTURE_EMAIL]);
});

describe('GET /api/users/:id/avatar', () => {
    it('returns 400 for a non-UUID id (not 500)', async () => {
        const res = await request(app)
            .get('/api/users/non-uuid/avatar')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(400);
    });

    it('returns 400 for an empty-ish id like "abc"', async () => {
        const res = await request(app)
            .get('/api/users/abc/avatar')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(400);
    });

    it('accepts a valid UUID-shaped id (may 404 if no avatar, but not 400/500)', async () => {
        const res = await request(app)
            .get(`/api/users/${userId}/avatar`)
            .set('Authorization', `Bearer ${token}`);
        // 200 if avatar exists; non-400/500 for a valid UUID is what we assert
        expect(res.status).not.toBe(400);
        expect(res.status).not.toBe(500);
    });
});

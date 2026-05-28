'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const db = require('../config/database');
const ns = require('../services/notification.service');
const { success } = require('../utils/response');
const { buildMeta } = require('../utils/pagination');

router.use(authMiddleware);

// GET /api/notifications — paginated list of notifications for the current user
router.get('/',
    validate({
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20),
            unread_only: Joi.boolean().default(false),
        }),
    }),
    async (req, res, next) => {
        try {
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const offset = (page - 1) * limit;
            const where = ['recipient_user_id = $1'];
            const params = [req.user.id];
            if (String(req.query.unread_only) === 'true') {
                where.push('is_read = false');
            }
            const totalRes = await db.query(
                `SELECT count(*)::int AS n FROM notifications WHERE ${where.join(' AND ')}`,
                params,
            );
            params.push(limit);
            params.push(offset);
            const r = await db.query(
                `SELECT id, title, message, related_module, related_entity_type, related_entity_id,
                        sender_user_id, is_read, created_at
                   FROM notifications
                  WHERE ${where.join(' AND ')}
                  ORDER BY created_at DESC
                  LIMIT $${params.length - 1} OFFSET $${params.length}`,
                params,
            );
            // Convention: rows are the envelope `data` array, pagination in `meta`
            // (matches every other list endpoint + the frontend `apiList` helper).
            res.json(success(r.rows, buildMeta(totalRes.rows[0].n, page, limit)));
        } catch (e) { next(e); }
    });

// GET /api/notifications/all — alias for the dropdown (no pagination metadata)
router.get('/all', async (req, res, next) => {
    try {
        const r = await db.query(
            `SELECT id, title, message, related_module, related_entity_type, related_entity_id,
                    sender_user_id, is_read, created_at
               FROM notifications
              WHERE recipient_user_id = $1
              ORDER BY created_at DESC
              LIMIT 50`,
            [req.user.id],
        );
        // Bare array as `data` (no pagination) — same contract as `/`.
        res.json(success(r.rows));
    } catch (e) { next(e); }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res, next) => {
    try {
        const r = await db.query(
            `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND is_read = false`,
            [req.user.id],
        );
        res.json(success({ count: r.rows[0].n }));
    } catch (e) { next(e); }
});

// POST /api/notifications/:id/read
router.post('/:id/read',
    validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
    async (req, res, next) => {
        try {
            await ns.markRead(req.params.id, req.user.id);
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

// PUT /api/notifications/read-all (and POST alias)
async function markAllReadHandler(req, res, next) {
    try {
        const result = await ns.markAllRead(req.user.id);
        res.json(success({ updated: result?.updated ?? 0 }));
    } catch (e) { next(e); }
}
router.put('/read-all', markAllReadHandler);
router.post('/read-all', markAllReadHandler);

module.exports = router;

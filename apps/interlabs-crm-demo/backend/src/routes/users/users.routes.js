'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// GET /api/users — paginated list (Setup → Roles).
// Superadmin/CEO see everyone; others scoped to their own role unless granted.
router.get('/',
    rbacGuard('admin_rbac', 'view_global'),
    validate({
        query: Joi.object({
            role: Joi.string().allow('', null),
            account_status: Joi.string().valid('active', 'inactive', 'suspended').allow('', null),
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(200).default(50),
            q: Joi.string().allow('', null),
        }),
    }),
    async (req, res, next) => {
        try {
            const { role, account_status, q } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 50;
            const offset = (page - 1) * limit;
            const params = [];
            const where = ['u.deleted_at IS NULL'];

            if (role) {
                params.push(role);
                where.push(`u.role = $${params.length}`);
            }
            if (account_status) {
                params.push(account_status);
                where.push(`u.account_status = $${params.length}`);
            }
            if (q) {
                params.push(`%${q}%`);
                where.push(`(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`);
            }

            const whereSql = where.join(' AND ');
            const totalRes = await db.query(
                `SELECT count(*)::int AS n FROM users u WHERE ${whereSql}`, params,
            );
            const total = totalRes.rows[0].n;

            params.push(limit);
            params.push(offset);
            const listRes = await db.query(`
                SELECT
                    u.id, u.email, u.display_name, u.role,
                    u.permission_level, u.avatar_url, u.account_status,
                    u.created_at, u.updated_at, u.created_by, u.updated_by,
                    s.managed_role_scope, COALESCE(s.can_manage_same_role, false) AS can_manage_same_role,
                    s.feature_permission_scope
                  FROM users u
                  LEFT JOIN user_role_scope s ON s.user_id = u.id
                 WHERE ${whereSql}
                 ORDER BY u.created_at DESC
                 LIMIT $${params.length - 1} OFFSET $${params.length}`,
                params,
            );

            res.json(success({ items: listRes.rows, total, page, limit }));
        } catch (e) { next(e); }
    });

// GET /api/users/:id
router.get('/:id',
    rbacGuard('admin_rbac', 'view_global'),
    validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
    async (req, res, next) => {
        try {
            const r = await db.query(`
                SELECT
                    u.id, u.email, u.display_name, u.role,
                    u.permission_level, u.avatar_url, u.account_status,
                    u.created_at, u.updated_at, u.created_by, u.updated_by,
                    s.managed_role_scope, COALESCE(s.can_manage_same_role, false) AS can_manage_same_role,
                    s.feature_permission_scope
                  FROM users u
                  LEFT JOIN user_role_scope s ON s.user_id = u.id
                 WHERE u.id = $1 AND u.deleted_at IS NULL`,
                [req.params.id],
            );
            if (!r.rowCount) return res.status(404).json({ success: false, error: 'user not found' });
            res.json(success(r.rows[0]));
        } catch (e) { next(e); }
    });

// PATCH /api/users/:id — update display_name / account_status / role / level
router.patch('/:id',
    rbacGuard('admin_rbac', 'edit'),
    validate({
        params: Joi.object({ id: Joi.string().uuid().required() }),
        body: Joi.object({
            display_name: Joi.string().min(1).max(120),
            account_status: Joi.string().valid('active', 'inactive', 'suspended'),
            role: Joi.string(),
            level_id: Joi.string().uuid().allow(null),
        }).min(1),
    }),
    async (req, res, next) => {
        try {
            const { display_name, account_status, role, level_id } = req.body;
            const fields = [];
            const values = [req.params.id];
            if ('display_name' in req.body) {
                fields.push(`display_name = $${values.length + 1}`);
                values.push(display_name);
            }
            if ('account_status' in req.body) {
                fields.push(`account_status = $${values.length + 1}`);
                values.push(account_status);
            }
            if ('role' in req.body) {
                fields.push(`role = $${values.length + 1}`);
                values.push(role);
            }
            if ('level_id' in req.body) {
                fields.push(`level_id = $${values.length + 1}`);
                values.push(level_id);
            }
            fields.push('updated_at = now()');
            const r = await db.query(
                `UPDATE users SET ${fields.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
                values,
            );
            if (!r.rowCount) return res.status(404).json({ success: false, error: 'user not found' });
            res.json(success({ id: r.rows[0].id }));
        } catch (e) { next(e); }
    });

// DELETE /api/users/:id — soft-delete
router.delete('/:id',
    rbacGuard('admin_rbac', 'delete'),
    validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
    async (req, res, next) => {
        try {
            await db.query(
                `UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
                [req.params.id],
            );
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

module.exports = router;

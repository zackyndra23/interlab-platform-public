'use strict';
const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const v = require('../../validators/levels.validators');
const svc = require('../../services/role_level.service');
const { success } = require('../../utils/response');

const router = express.Router();

// All admin/levels routes require a valid JWT.
router.use(authMiddleware);

// GET /api/admin/roles/:roleKey/levels — list active levels for a role
router.get(
    '/roles/:roleKey/levels',
    rbacGuard('admin_rbac', 'view_global'),
    async (req, res, next) => {
        try {
            const items = await svc.listByRole(req.params.roleKey);
            res.json(success({ items }));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/roles/:roleKey/levels — create a level
router.post(
    '/roles/:roleKey/levels',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.create }),
    async (req, res, next) => {
        try {
            const lvl = await svc.create({
                actor: req.user,
                roleKey: req.params.roleKey,
                ...req.body,
            });
            res.status(201).json(success(lvl));
        } catch (e) { next(e); }
    },
);

// PATCH /api/admin/levels/:id — partial update
router.patch(
    '/levels/:id',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.update }),
    async (req, res, next) => {
        try {
            const lvl = await svc.update({
                actor: req.user,
                levelId: req.params.id,
                patch: req.body,
            });
            res.json(success(lvl));
        } catch (e) { next(e); }
    },
);

// DELETE /api/admin/levels/:id — soft-delete
router.delete(
    '/levels/:id',
    rbacGuard('admin_rbac', 'delete'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            const result = await svc.remove({
                actor: req.user,
                levelId: req.params.id,
            });
            res.json(success(result));
        } catch (e) { next(e); }
    },
);

module.exports = router;

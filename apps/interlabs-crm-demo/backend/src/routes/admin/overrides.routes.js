'use strict';
const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const v = require('../../validators/overrides.validators');
const svc = require('../../services/permission_override.service');
const { success } = require('../../utils/response');

const router = express.Router();

// All override admin routes require a valid JWT.
router.use(authMiddleware);

// GET /api/admin/users/:id/overrides
// Returns the active per-user capability overrides + cross-dept grants for the target user.
router.get(
    '/users/:id/overrides',
    rbacGuard('admin_rbac', 'view_global'),
    async (req, res, next) => {
        try {
            const [capabilities, crossDept] = await Promise.all([
                svc.listForUser(req.params.id),
                svc.listCrossDeptForUser(req.params.id),
            ]);
            res.json(success({ capabilities, crossDept }));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/users/:id/overrides/grant
// Issue (or re-activate) a per-user GRANT override.
router.post(
    '/users/:id/overrides/grant',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.grant }),
    async (req, res, next) => {
        try {
            const row = await svc.grant({
                actor: req.user,
                userId: req.params.id,
                ...req.body,
            });
            res.status(201).json(success(row));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/users/:id/overrides/deny
// Issue (or re-activate) a per-user DENY override.
router.post(
    '/users/:id/overrides/deny',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.grant }),
    async (req, res, next) => {
        try {
            const row = await svc.deny({
                actor: req.user,
                userId: req.params.id,
                ...req.body,
            });
            res.status(201).json(success(row));
        } catch (e) { next(e); }
    },
);

// DELETE /api/admin/users/:id/overrides/:overrideType/:featureId/:capabilityId
// Revoke a specific override (sets revoked_at = now()).
router.delete(
    '/users/:id/overrides/:overrideType/:featureId/:capabilityId',
    rbacGuard('admin_rbac', 'delete'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            const result = await svc.revoke({
                actor: req.user,
                userId: req.params.id,
                overrideType: req.params.overrideType,
                featureId: req.params.featureId,
                capabilityId: req.params.capabilityId,
            });
            res.json(success(result));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/users/:id/cross-dept-grants
// Issue (or re-activate) a cross-department grant for the target user.
router.post(
    '/users/:id/cross-dept-grants',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.crossDept }),
    async (req, res, next) => {
        try {
            const row = await svc.grantCrossDept({
                actor: req.user,
                granteeUserId: req.params.id,
                ...req.body,
            });
            res.status(201).json(success(row));
        } catch (e) { next(e); }
    },
);

// DELETE /api/admin/cross-dept-grants/:id
// Revoke a cross-department grant by its UUID.
router.delete(
    '/cross-dept-grants/:id',
    rbacGuard('admin_rbac', 'delete'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            const result = await svc.revokeCrossDept({
                actor: req.user,
                grantId: req.params.id,
            });
            res.json(success(result));
        } catch (e) { next(e); }
    },
);

module.exports = router;

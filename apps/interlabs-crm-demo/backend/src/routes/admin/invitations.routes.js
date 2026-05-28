'use strict';
const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter, invitationCreateLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/invitations.validators');
const svc = require('../../services/invitation.service');
const { success } = require('../../utils/response');

const router = express.Router();

// All admin/invitations routes require a valid JWT.
router.use(authMiddleware);

// GET /api/admin/invitations — list invitations
// Superadmin/CEO see all; managers see only their own.
// Optional ?status= filter.
router.get(
    '/invitations',
    rbacGuard('admin_rbac', 'view_global'),
    async (req, res, next) => {
        try {
            const items = await svc.list({ actor: req.user, status: req.query.status || null });
            res.json(success({ items }));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/invitations — issue a new invitation
// Returns activationToken + initialPassword ONCE (never stored in plaintext).
router.post(
    '/invitations',
    rbacGuard('admin_rbac', 'invite_user'),
    invitationCreateLimiter,
    validate({ body: v.create }),
    async (req, res, next) => {
        try {
            const r = await svc.create({ actor: req.user, ...req.body });
            res.status(201).json(success(r));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/invitations/:id/revoke — cancel a pending invitation
router.post(
    '/invitations/:id/revoke',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: v.revoke }),
    async (req, res, next) => {
        try {
            await svc.revoke({ actor: req.user, invitationId: req.params.id, reason: req.body.reason || null });
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    },
);

// POST /api/admin/invitations/:id/resend — revoke old + issue fresh token + password
router.post(
    '/invitations/:id/resend',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            const r = await svc.resend({ actor: req.user, invitationId: req.params.id });
            res.json(success(r));
        } catch (e) { next(e); }
    },
);

module.exports = router;

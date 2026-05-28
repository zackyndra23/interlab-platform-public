'use strict';
const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const v = require('../../validators/reset.validators');
const svc = require('../../services/auth.service');
const { success } = require('../../utils/response');

const router = express.Router();
router.use(authMiddleware);

// POST /api/admin/reset-to-backup — superadmin/CEO reset a user to their backup password.
router.post(
    '/reset-to-backup',
    rbacGuard('admin_rbac', 'reset_user_password'),
    permissionWriteLimiter,
    validate({ body: v.resetToBackup }),
    async (req, res, next) => {
        try {
            const r = await svc.resetToBackup({ actor: req.user, targetUserId: req.body.userId });
            res.json(success(r));
        } catch (e) { next(e); }
    },
);

module.exports = router;

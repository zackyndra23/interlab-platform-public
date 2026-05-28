'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/po_stage.validators');
const po = require('../../services/po.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// POST /api/po/:id/reject
router.post('/:id/reject',
    rbacGuard('sales_po', 'reject_stage'),
    permissionWriteLimiter,
    validate({ body: v.reject }),
    async (req, res, next) => {
        try {
            const r = await po.rejectStage({
                actor: req.user, poId: req.params.id,
                toStatus: req.body.toStatus, reason: req.body.reason,
            });
            res.json(success(r));
        } catch (e) { next(e); }
    });

// POST /api/po/:id/admin-override
router.post('/:id/admin-override',
    rbacGuard('sales_po', 'admin_override_stage'),
    permissionWriteLimiter,
    validate({ body: v.adminOverride }),
    async (req, res, next) => {
        try {
            const r = await po.adminOverrideStage({
                actor: req.user, poId: req.params.id,
                targetStatus: req.body.targetStatus, reason: req.body.reason,
            });
            res.json(success(r));
        } catch (e) { next(e); }
    });

// GET /api/po/:id/history
// Uses view_own (not view_global) so all division roles can access the PO
// stage audit trail. view_global is not granted to any division role, which
// would make this endpoint unreachable for Sales/Finance/Technical/etc.
// Further data-scope narrowing happens at the query layer if needed.
router.get('/:id/history',
    rbacGuard('sales_po', 'view_own'),
    async (req, res, next) => {
        try {
            const h = await po.getHistory(req.params.id);
            res.json(success({ items: h }));
        } catch (e) { next(e); }
    });

module.exports = router;

'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const adminLog = require('../services/admin_log.service');
const v = require('../validators/admin_log.validators');

const router = express.Router();

router.use(authMiddleware);

// Listing scope for Admin & Log routes.
//
// AWB, DO, and Operational rows are all created by Admin & Log users, so a
// plain created_by scope works for non-admin-log roles. However, the
// Admin & Log role owns the module wholesale — they see every record
// regardless of which Admin & Log user created it. Superadmin/CEO bypass
// scoping (view_global). All other roles keep strict per-creator scoping so
// cross-division visibility is controlled by the rbacGuard's view_own
// capability check.
function adminLogScopeUserId(req) {
    const { role } = req.user;
    if (role === 'superadmin' || role === 'ceo' || role === 'admin_log') {
        return null;
    }
    return req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// AIRWAY BILL (AWB)  /api/admin-log/awb
// ============================================================================

router.get(
    '/awb',
    rbacGuard('awb', 'view_own'),
    validate({ query: v.awbListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await adminLog.listAwb({
            query: req.query,
            scopeUserId: adminLogScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/awb/:id',
    rbacGuard('awb', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.getAwb(req.params.id)));
    }),
);

router.get(
    '/awb/:id/history',
    rbacGuard('awb', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.getAwbHistory(req.params.id)));
    }),
);

router.post(
    '/awb',
    rbacGuard('awb', 'create'),
    validate({ body: v.awbCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await adminLog.createAwb(req.body, req.user)));
    }),
);

router.put(
    '/awb/:id',
    rbacGuard('awb', 'edit'),
    validate({ params: v.idParam, body: v.awbUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.updateAwb(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/awb/:id',
    rbacGuard('awb', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await adminLog.deleteAwb(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// DELIVERY ORDER (DO)  /api/admin-log/delivery-orders
// ============================================================================

router.get(
    '/delivery-orders',
    rbacGuard('delivery_order', 'view_own'),
    validate({ query: v.deliveryOrderListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await adminLog.listDeliveryOrders({
            query: req.query,
            scopeUserId: adminLogScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/delivery-orders/:id',
    rbacGuard('delivery_order', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.getDeliveryOrder(req.params.id)));
    }),
);

router.get(
    '/delivery-orders/:id/history',
    rbacGuard('delivery_order', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.getDeliveryOrderHistory(req.params.id)));
    }),
);

router.post(
    '/delivery-orders',
    rbacGuard('delivery_order', 'create'),
    validate({ body: v.deliveryOrderCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await adminLog.createDeliveryOrder(req.body, req.user)));
    }),
);

router.put(
    '/delivery-orders/:id',
    rbacGuard('delivery_order', 'edit'),
    validate({ params: v.idParam, body: v.deliveryOrderUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.updateDeliveryOrder(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/delivery-orders/:id',
    rbacGuard('delivery_order', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await adminLog.deleteDeliveryOrder(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// OPERATIONAL  /api/admin-log/operational
// ============================================================================

router.get(
    '/operational',
    rbacGuard('admin_operational', 'view_own'),
    validate({ query: v.operationalListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await adminLog.listOperational({
            query: req.query,
            scopeUserId: adminLogScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/operational/:id',
    rbacGuard('admin_operational', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.getOperational(req.params.id)));
    }),
);

router.post(
    '/operational',
    rbacGuard('admin_operational', 'create'),
    validate({ body: v.operationalCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await adminLog.createOperational(req.body, req.user)));
    }),
);

router.put(
    '/operational/:id',
    rbacGuard('admin_operational', 'edit'),
    validate({ params: v.idParam, body: v.operationalUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await adminLog.updateOperational(req.params.id, req.body, req.user)));
    }),
);

router.post(
    '/operational/:id/transition',
    rbacGuard('admin_operational', 'edit'),
    validate({ params: v.idParam, body: v.operationalTransition }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await adminLog.transitionOperational(req.params.id, req.body.workflow_status, req.user),
        ));
    }),
);

router.delete(
    '/operational/:id',
    rbacGuard('admin_operational', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await adminLog.deleteOperational(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// READY-TO-DELIVER  /api/admin-log/ready-to-deliver
//
// Admin & Log responds to Technical's Ready-to-Deliver signal on an
// installation_records row. Listing returns pending signals so the
// Ready-to-Deliver dashboard widget can render them sorted by approaching
// 2-working-day SLA deadline.
// ============================================================================

router.get(
    '/ready-to-deliver',
    rbacGuard('delivery_order', 'view_own'),
    validate({ query: v.readyToDeliverListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await adminLog.listReadyToDeliver({ query: req.query });
        res.json(success(rows, meta));
    }),
);

router.post(
    '/ready-to-deliver/:id/acknowledge',
    rbacGuard('delivery_order', 'edit'),
    validate({ params: v.idParam, body: v.readyToDeliverAcknowledge }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await adminLog.acknowledgeReadyToDeliver(req.params.id, req.body, req.user),
        ));
    }),
);

module.exports = router;

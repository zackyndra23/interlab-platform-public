'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const technical = require('../services/technical.service');
const v = require('../validators/technical.validators');

const router = express.Router();

router.use(authMiddleware);

// Listing scope: Technical role owns the module wholesale (same rationale as
// financeScopeUserId and adminLogScopeUserId). Superadmin/CEO bypass scoping
// inside rbac.middleware; all other roles keep strict per-creator scoping.
function technicalScopeUserId(req) {
    const { role } = req.user;
    if (role === 'superadmin' || role === 'ceo' || role === 'technical') {
        return null;
    }
    return req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// JOB ORDER  /api/technical/job-orders
// ============================================================================

router.get(
    '/job-orders',
    rbacGuard('technical_job_order', 'view_own'),
    validate({ query: v.jobOrderListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listJobOrders({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/job-orders/:id',
    rbacGuard('technical_job_order', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getJobOrder(req.params.id)));
    }),
);

router.post(
    '/job-orders',
    rbacGuard('technical_job_order', 'create'),
    validate({ body: v.jobOrderCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createJobOrder(req.body, req.user)));
    }),
);

router.put(
    '/job-orders/:id',
    rbacGuard('technical_job_order', 'edit'),
    validate({ params: v.idParam, body: v.jobOrderUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updateJobOrder(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/job-orders/:id',
    rbacGuard('technical_job_order', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deleteJobOrder(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// INSTALLATION  /api/technical/installations
// ============================================================================

router.get(
    '/installations',
    rbacGuard('installation', 'view_own'),
    validate({ query: v.installationListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listInstallations({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/installations/:id',
    rbacGuard('installation', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getInstallation(req.params.id)));
    }),
);

router.post(
    '/installations',
    rbacGuard('installation', 'create'),
    validate({ body: v.installationCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createInstallation(req.body, req.user)));
    }),
);

router.put(
    '/installations/:id',
    rbacGuard('installation', 'edit'),
    validate({ params: v.idParam, body: v.installationUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updateInstallation(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/installations/:id/ready-to-deliver',
    rbacGuard('installation', 'write'),
    validate({ params: v.idParam, body: v.readyToDeliverRequest }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await technical.markReadyToDeliver(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/installations/:id',
    rbacGuard('installation', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deleteInstallation(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// PM  /api/technical/pm
// ============================================================================

router.get(
    '/pm',
    rbacGuard('pm', 'view_own'),
    validate({ query: v.pmListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listPm({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/pm/:id',
    rbacGuard('pm', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getPm(req.params.id)));
    }),
);

router.post(
    '/pm',
    rbacGuard('pm', 'create'),
    validate({ body: v.pmCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createPm(req.body, req.user)));
    }),
);

router.put(
    '/pm/:id',
    rbacGuard('pm', 'edit'),
    validate({ params: v.idParam, body: v.pmUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updatePm(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/pm/:id',
    rbacGuard('pm', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deletePm(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// SPAREPART  /api/technical/spareparts
// ============================================================================

router.get(
    '/spareparts',
    rbacGuard('sparepart', 'view_own'),
    validate({ query: v.sparepartListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listSparepart({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/spareparts/:id',
    rbacGuard('sparepart', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getSparepart(req.params.id)));
    }),
);

router.post(
    '/spareparts',
    rbacGuard('sparepart', 'create'),
    validate({ body: v.sparepartCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createSparepart(req.body, req.user)));
    }),
);

router.put(
    '/spareparts/:id',
    rbacGuard('sparepart', 'edit'),
    validate({ params: v.idParam, body: v.sparepartUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updateSparepart(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/spareparts/:id',
    rbacGuard('sparepart', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deleteSparepart(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// INSPECTION & QC  /api/technical/inspection-qc
// ============================================================================

router.get(
    '/inspection-qc',
    rbacGuard('inspection_qc', 'view_own'),
    validate({ query: v.qcListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listQc({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/inspection-qc/:id',
    rbacGuard('inspection_qc', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getQc(req.params.id)));
    }),
);

router.post(
    '/inspection-qc',
    rbacGuard('inspection_qc', 'create'),
    validate({ body: v.qcCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createQc(req.body, req.user)));
    }),
);

router.put(
    '/inspection-qc/:id',
    rbacGuard('inspection_qc', 'edit'),
    validate({ params: v.idParam, body: v.qcUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updateQc(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/inspection-qc/:id/submit-review',
    rbacGuard('inspection_qc', 'approve'),
    validate({ params: v.idParam, body: v.qcSubmitReview }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await technical.submitQcReview(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/inspection-qc/:id',
    rbacGuard('inspection_qc', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deleteQc(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// BAST  /api/technical/bast
// ============================================================================

router.get(
    '/bast',
    rbacGuard('bast', 'view_own'),
    validate({ query: v.bastListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await technical.listBast({
            query: req.query,
            scopeUserId: technicalScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/bast/:id',
    rbacGuard('bast', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.getBast(req.params.id)));
    }),
);

router.post(
    '/bast',
    rbacGuard('bast', 'create'),
    validate({ body: v.bastCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await technical.createBast(req.body, req.user)));
    }),
);

router.put(
    '/bast/:id',
    rbacGuard('bast', 'edit'),
    validate({ params: v.idParam, body: v.bastUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await technical.updateBast(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/bast/:id/send-to-finance',
    rbacGuard('bast', 'write'),
    validate({ params: v.idParam, body: v.bastSendToFinance }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await technical.sendBastToFinance(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/bast/:id',
    rbacGuard('bast', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await technical.deleteBast(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

module.exports = router;

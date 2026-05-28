'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const tax = require('../services/tax.service');
const v = require('../validators/tax.validators');

const router = express.Router();

router.use(authMiddleware);

// Listing scope for Tax routes. Tax & Insurance owns the module wholesale
// (MOD_tax_insurance §Role). Superadmin / CEO / tax_insurance see all rows;
// any other role that somehow reaches these endpoints falls back to
// per-creator scoping. Mirrors technicalScopeUserId / financeScopeUserId.
function taxScopeUserId(req) {
    const { role } = req.user;
    if (role === 'superadmin' || role === 'ceo' || role === 'tax_insurance') {
        return null;
    }
    return req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// DASHBOARD  /api/tax/dashboard/*
//   Mounted above /operational/:id so '/dashboard/...' isn't captured as
//   an id param.
// ============================================================================

router.get(
    '/dashboard/current-masa-pajak',
    rbacGuard('tax_operational', 'view_own'),
    asyncHandler(async (_req, res) => {
        res.json(success(await tax.dashboardCurrentMasaPajak()));
    }),
);

router.get(
    '/dashboard/monthly-summary/:taxType',
    rbacGuard('tax_operational', 'view_own'),
    validate({ query: v.dashboardQuery }),
    asyncHandler(async (req, res) => {
        const months = req.query.months ?? 12;
        res.json(success(
            await tax.dashboardMonthlySummary(req.params.taxType, months),
        ));
    }),
);

router.get(
    '/dashboard/ppn-summary',
    rbacGuard('tax_operational', 'view_own'),
    validate({ query: v.dashboardQuery }),
    asyncHandler(async (req, res) => {
        res.json(success(await tax.dashboardPpnSummary(req.query.months ?? 12)));
    }),
);

router.get(
    '/dashboard/recent-activity',
    rbacGuard('tax_operational', 'view_own'),
    asyncHandler(async (_req, res) => {
        res.json(success(await tax.dashboardRecentActivity(5)));
    }),
);

router.get(
    '/dashboard/pending-actions',
    rbacGuard('tax_operational', 'view_own'),
    asyncHandler(async (_req, res) => {
        res.json(success(await tax.dashboardPendingActions()));
    }),
);

// ============================================================================
// TAX OPERATIONAL  /api/tax/operational
// ============================================================================

router.get(
    '/operational',
    rbacGuard('tax_operational', 'view_own'),
    validate({ query: v.taxOperationalListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await tax.listRecords({
            query: req.query,
            scopeUserId: taxScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/operational/:id',
    rbacGuard('tax_operational', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await tax.getRecord(req.params.id)));
    }),
);

router.post(
    '/operational',
    rbacGuard('tax_operational', 'create'),
    validate({ body: v.taxOperationalCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await tax.createRecord(req.body, req.user),
        ));
    }),
);

router.put(
    '/operational/:id',
    rbacGuard('tax_operational', 'edit'),
    validate({ params: v.idParam, body: v.taxOperationalUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await tax.updateRecord(req.params.id, req.body, req.user),
        ));
    }),
);

router.put(
    '/operational/:id/status',
    rbacGuard('tax_operational', 'edit'),
    validate({ params: v.idParam, body: v.taxOperationalStatusChange }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await tax.changeStatus(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/operational/:id',
    rbacGuard('tax_operational', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await tax.deleteRecord(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// AUDIT LOG  /api/tax/operational/:id/audit
//   Regulator-facing mutation history. Listed separately so RBAC can be
//   widened/narrowed independently of the record CRUD feature.
// ============================================================================

router.get(
    '/operational/:id/audit',
    rbacGuard('tax_operational', 'view_own'),
    validate({ params: v.idParam, query: v.taxAuditListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await tax.listAuditLog(req.params.id, {
            query: req.query,
        });
        res.json(success(rows, meta));
    }),
);

module.exports = router;

'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const sales = require('../services/sales.service');
const v = require('../validators/sales.validators');

const router = express.Router();

// All Sales routes require an authenticated user.
router.use(authMiddleware);

// view_own is the default scope; Superadmin/CEO short-circuit to global
// inside rbac.middleware. Scope filter for listings: if the caller is NOT
// superadmin/ceo, constrain created_by = req.user.id.
function ownedScopeUserId(req) {
    return (req.user.role === 'superadmin' || req.user.role === 'ceo')
        ? null
        : req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// CUSTOMERS  /api/sales/customers
// ============================================================================

router.get(
    '/customers',
    rbacGuard('customers', 'view_own'),
    validate({ query: v.customerListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listCustomers({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/customers/:id',
    rbacGuard('customers', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        const row = await sales.getCustomer(req.params.id);
        res.json(success(row));
    }),
);

router.post(
    '/customers',
    rbacGuard('customers', 'create'),
    validate({ body: v.customerCreate }),
    asyncHandler(async (req, res) => {
        const row = await sales.createCustomer(req.body, req.user);
        res.status(201).json(success(row));
    }),
);

router.put(
    '/customers/:id',
    rbacGuard('customers', 'edit'),
    validate({ params: v.idParam, body: v.customerUpdate }),
    asyncHandler(async (req, res) => {
        const row = await sales.updateCustomer(req.params.id, req.body, req.user);
        res.json(success(row));
    }),
);

router.delete(
    '/customers/:id',
    rbacGuard('customers', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteCustomer(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// SALES FORECAST  /api/sales/forecasts
// ============================================================================

router.get(
    '/forecasts',
    rbacGuard('sales_forecast', 'view_own'),
    validate({ query: v.forecastListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listForecasts({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/forecasts/:id',
    rbacGuard('sales_forecast', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.getForecast(req.params.id)));
    }),
);

router.post(
    '/forecasts',
    rbacGuard('sales_forecast', 'create'),
    validate({ body: v.forecastCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await sales.createForecast(req.body, req.user)));
    }),
);

router.put(
    '/forecasts/:id',
    rbacGuard('sales_forecast', 'edit'),
    validate({ params: v.idParam, body: v.forecastUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.updateForecast(req.params.id, req.body, req.user)));
    }),
);

router.post(
    '/forecasts/:id/submit',
    rbacGuard('sales_forecast', 'edit'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.submitForecast(req.params.id, req.user)));
    }),
);

router.delete(
    '/forecasts/:id',
    rbacGuard('sales_forecast', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteForecast(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// QUOTATIONS  /api/sales/quotations
// ============================================================================

router.get(
    '/quotations',
    rbacGuard('quotation', 'view_own'),
    validate({ query: v.quotationListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listQuotations({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/quotations/:id',
    rbacGuard('quotation', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.getQuotation(req.params.id)));
    }),
);

router.post(
    '/quotations',
    rbacGuard('quotation', 'create'),
    validate({ body: v.quotationCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await sales.createQuotation(req.body, req.user)));
    }),
);

router.put(
    '/quotations/:id',
    rbacGuard('quotation', 'edit'),
    validate({ params: v.idParam, body: v.quotationUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.updateQuotation(req.params.id, req.body, req.user)));
    }),
);

router.post(
    '/quotations/:id/transition',
    rbacGuard('quotation', 'edit'),
    validate({ params: v.idParam, body: v.quotationTransition }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.transitionQuotation(
            req.params.id, req.body.workflow_status, req.user,
        )));
    }),
);

router.delete(
    '/quotations/:id',
    rbacGuard('quotation', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteQuotation(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// HARGA POKOK PENJUALAN  /api/sales/harga-pokok-penjualan
// ============================================================================

router.get(
    '/harga-pokok-penjualan',
    rbacGuard('hpp', 'view_own'),
    validate({ query: v.hppListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listHpp({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/harga-pokok-penjualan/:id',
    rbacGuard('hpp', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.getHpp(req.params.id)));
    }),
);

router.post(
    '/harga-pokok-penjualan',
    rbacGuard('hpp', 'create'),
    validate({ body: v.hppCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await sales.createHpp(req.body, req.user)));
    }),
);

router.put(
    '/harga-pokok-penjualan/:id',
    rbacGuard('hpp', 'edit'),
    validate({ params: v.idParam, body: v.hppUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.updateHpp(req.params.id, req.body, req.user)));
    }),
);

router.post(
    '/harga-pokok-penjualan/:id/transition',
    rbacGuard('hpp', 'edit'),
    validate({ params: v.idParam, body: v.hppTransition }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.transitionHpp(
            req.params.id, req.body.workflow_status, req.user,
        )));
    }),
);

router.delete(
    '/harga-pokok-penjualan/:id',
    rbacGuard('hpp', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteHpp(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// SALES PURCHASE ORDER  /api/sales/purchase-orders
// ============================================================================

router.get(
    '/purchase-orders',
    rbacGuard('sales_po', 'view_own'),
    validate({ query: v.salesPoListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listSalesPo({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/purchase-orders/:id',
    rbacGuard('sales_po', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.getSalesPo(req.params.id)));
    }),
);

router.post(
    '/purchase-orders',
    rbacGuard('sales_po', 'create'),
    validate({ body: v.salesPoCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await sales.createSalesPo(req.body, req.user)));
    }),
);

router.put(
    '/purchase-orders/:id',
    rbacGuard('sales_po', 'edit'),
    validate({ params: v.idParam, body: v.salesPoUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.updateSalesPo(req.params.id, req.body, req.user)));
    }),
);

// POST /:id/submit — initialize master PO (status=Registered) + fire notifications.
router.post(
    '/purchase-orders/:id/submit',
    rbacGuard('sales_po', 'edit'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.submitSalesPo(req.params.id, req.user)));
    }),
);

// POST /:id/process — advance master PO Registered → Processed.
router.post(
    '/purchase-orders/:id/process',
    rbacGuard('sales_po', 'edit'),
    validate({ params: v.idParam, body: v.salesPoProcess }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.processSalesPo(req.params.id, req.user, req.body)));
    }),
);

// POST /:id/overdue-reason — submit SLA-breach justification.
router.post(
    '/purchase-orders/:id/overdue-reason',
    rbacGuard('sales_po', 'edit'),
    validate({ params: v.idParam, body: v.salesPoOverdueReason }),
    asyncHandler(async (req, res) => {
        const body = { reason: req.body.reason, attachmentId: req.body.attachment_id };
        res.json(success(await sales.submitOverdueReason(req.params.id, body, req.user)));
    }),
);

router.delete(
    '/purchase-orders/:id',
    rbacGuard('sales_po', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteSalesPo(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// SALES PURCHASE REQUEST  /api/sales/purchase-requests
// ============================================================================

router.get(
    '/purchase-requests',
    rbacGuard('sales_pr', 'view_own'),
    validate({ query: v.salesPrListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await sales.listSalesPr({
            query: req.query,
            scopeUserId: ownedScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/purchase-requests/:id',
    rbacGuard('sales_pr', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.getSalesPr(req.params.id)));
    }),
);

router.post(
    '/purchase-requests',
    rbacGuard('sales_pr', 'create'),
    validate({ body: v.salesPrCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(await sales.createSalesPr(req.body, req.user)));
    }),
);

router.put(
    '/purchase-requests/:id',
    rbacGuard('sales_pr', 'edit'),
    validate({ params: v.idParam, body: v.salesPrUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.updateSalesPr(req.params.id, req.body, req.user)));
    }),
);

// POST /:id/submit — create mirror Finance Purchase Requisition and notify Finance.
router.post(
    '/purchase-requests/:id/submit',
    rbacGuard('sales_pr', 'edit'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await sales.submitSalesPr(req.params.id, req.user)));
    }),
);

router.delete(
    '/purchase-requests/:id',
    rbacGuard('sales_pr', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await sales.deleteSalesPr(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

module.exports = router;

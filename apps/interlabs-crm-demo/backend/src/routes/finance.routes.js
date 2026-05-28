'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const finance = require('../services/finance.service');
const v = require('../validators/finance.validators');

const router = express.Router();

router.use(authMiddleware);

// Listing scope for Finance routes.
//
// Per MOD_finance the entire Finance module (PO Customer, Purchase
// Requisition, Invoice Manufacture, Invoice Customer) is owned by the
// Finance role, but the rows are frequently created by upstream workflows
// in other divisions:
//
//   * po_customer_records.created_by     = Sales user (auto-created at
//                                           sales.service.submitSalesPo)
//   * purchase_requisitions.created_by   = Sales user (auto-created at
//                                           sales.service.submitSalesPr)
//   * invoice_customers.created_by       = Technical user (auto-created
//                                           at Technical BAST upload)
//
// A generic `created_by = actor` filter therefore hides the Finance
// user's own inbox from them. Since the Finance role owns the module
// wholesale, Finance users are treated like module admins here and see
// every Finance record — same as Superadmin/CEO. All other roles keep
// per-creator scoping so cross-role data leakage is still prevented.
//
// This relaxation is scoped to the Finance router only; Sales,
// Admin & Log, Technical, HRGA, and Tax routes continue to use their own
// stricter scope helpers.
function financeScopeUserId(req) {
    const { role } = req.user;
    if (role === 'superadmin' || role === 'ceo' || role === 'finance') {
        return null;
    }
    return req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// PO CUSTOMER  /api/finance/po-customers
//   Auto-created by Sales PO submit; no POST here. Listing/reading/updating
//   only.
// ============================================================================

router.get(
    '/po-customers',
    rbacGuard('po_customer', 'view_own'),
    validate({ query: v.poCustomerListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await finance.listPoCustomers({
            query: req.query,
            scopeUserId: financeScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/po-customers/:id',
    rbacGuard('po_customer', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.getPoCustomer(req.params.id)));
    }),
);

router.put(
    '/po-customers/:id',
    rbacGuard('po_customer', 'edit'),
    validate({ params: v.idParam, body: v.poCustomerUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.updatePoCustomer(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/po-customers/:id',
    rbacGuard('po_customer', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await finance.deletePoCustomer(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// PURCHASE REQUISITION  /api/finance/purchase-requisitions
//   Auto-created by Sales PR submit; /upload-po-out is the trigger that flips
//   status → Processed and advances master PO to Production.
// ============================================================================

router.get(
    '/purchase-requisitions',
    rbacGuard('purchase_requisition', 'view_own'),
    validate({ query: v.requisitionListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await finance.listRequisitions({
            query: req.query,
            scopeUserId: financeScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/purchase-requisitions/:id',
    rbacGuard('purchase_requisition', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.getRequisition(req.params.id)));
    }),
);

router.put(
    '/purchase-requisitions/:id',
    rbacGuard('purchase_requisition', 'edit'),
    validate({ params: v.idParam, body: v.requisitionUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.updateRequisition(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/purchase-requisitions/:id/upload-po-out',
    rbacGuard('purchase_requisition', 'edit'),
    validate({ params: v.idParam, body: v.requisitionUploadPoOut }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.processRequisition(req.params.id, req.body, req.user)));
    }),
);

router.delete(
    '/purchase-requisitions/:id',
    rbacGuard('purchase_requisition', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await finance.deleteRequisition(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// INVOICE MANUFACTURE  /api/finance/invoice-manufactures
// ============================================================================

router.get(
    '/invoice-manufactures',
    rbacGuard('invoice_manufacture', 'view_own'),
    validate({ query: v.invoiceManufactureListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await finance.listInvoiceManufactures({
            query: req.query,
            scopeUserId: financeScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/invoice-manufactures/:id',
    rbacGuard('invoice_manufacture', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.getInvoiceManufacture(req.params.id)));
    }),
);

router.post(
    '/invoice-manufactures',
    rbacGuard('invoice_manufacture', 'create'),
    validate({ body: v.invoiceManufactureCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(
            success(await finance.createInvoiceManufacture(req.body, req.user)),
        );
    }),
);

router.put(
    '/invoice-manufactures/:id',
    rbacGuard('invoice_manufacture', 'edit'),
    validate({ params: v.idParam, body: v.invoiceManufactureUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.updateInvoiceManufacture(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/invoice-manufactures/:id/upload-payment',
    rbacGuard('invoice_manufacture', 'edit'),
    validate({ params: v.idParam, body: v.invoiceManufactureUploadPayment }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await finance.recordInvoiceManufacturePayment(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/invoice-manufactures/:id',
    rbacGuard('invoice_manufacture', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await finance.deleteInvoiceManufacture(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// INVOICE CUSTOMER  /api/finance/invoice-customers
//   Draft auto-created by Technical BAST upload. /upload-invoice flips status
//   to Processed and advances master PO to Invoice.
// ============================================================================

router.get(
    '/invoice-customers',
    rbacGuard('invoice_customer', 'view_own'),
    validate({ query: v.invoiceCustomerListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await finance.listInvoiceCustomers({
            query: req.query,
            scopeUserId: financeScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/invoice-customers/:id',
    rbacGuard('invoice_customer', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.getInvoiceCustomer(req.params.id)));
    }),
);

router.put(
    '/invoice-customers/:id',
    rbacGuard('invoice_customer', 'edit'),
    validate({ params: v.idParam, body: v.invoiceCustomerUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(await finance.updateInvoiceCustomer(req.params.id, req.body, req.user)));
    }),
);

router.put(
    '/invoice-customers/:id/upload-invoice',
    rbacGuard('invoice_customer', 'edit'),
    validate({ params: v.idParam, body: v.invoiceCustomerUploadInvoice }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await finance.issueInvoiceCustomer(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/invoice-customers/:id',
    rbacGuard('invoice_customer', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await finance.deleteInvoiceCustomer(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

module.exports = router;

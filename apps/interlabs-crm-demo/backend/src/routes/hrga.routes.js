'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const hrga = require('../services/hrga.service');
const v = require('../validators/hrga.validators');

const router = express.Router();

router.use(authMiddleware);

// Listing scope for HRGA routes.
//
// MOD_hrga §ROLE: HRGA owns the entire module wholesale. Superadmin, CEO
// and HRGA see all rows; any other role that happens to hit these
// endpoints (per the RBAC matrix, most of the HRGA-specific routes only
// allow [superadmin, ceo, hrga] anyway — but Smart Search and
// Compliance Listing are cross-role) keeps per-creator scoping.
//
// Same-role user management is enforced separately by the user-management
// middleware, not here.
function hrgaScopeUserId(req) {
    const { role } = req.user;
    if (role === 'superadmin' || role === 'ceo' || role === 'hrga') {
        return null;
    }
    return req.user.id;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// SMART SEARCH  /api/hrga/search
//   Role-gated cross-source search. Must stay above the /legal-documents
//   prefix so Express doesn't match /search as an :id.
// ============================================================================

router.get(
    '/search',
    rbacGuard('hrga_legal', 'view_own'),
    validate({ query: v.smartSearchQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.smartSearch({
            query: req.query,
            actor: req.user,
        });
        res.json(success(rows, meta));
    }),
);

// ============================================================================
// COMPLIANCE & EXPIRY  /api/hrga/compliance
// ============================================================================

router.get(
    '/compliance/expiring',
    rbacGuard('hrga_compliance', 'view_own'),
    validate({ query: v.complianceExpiringQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.listExpiringDocuments({
            query: req.query,
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/compliance/summary',
    rbacGuard('hrga_compliance', 'view_own'),
    asyncHandler(async (_req, res) => {
        res.json(success(await hrga.complianceDashboardCounts()));
    }),
);

// ============================================================================
// LEGALITAS  /api/hrga/legal-documents
// ============================================================================

router.get(
    '/legal-documents',
    rbacGuard('hrga_legal', 'view_own'),
    validate({ query: v.legalDocumentListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.listLegalDocuments({
            query: req.query,
            scopeUserId: hrgaScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/legal-documents/:id',
    rbacGuard('hrga_legal', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await hrga.getLegalDocument(req.params.id)));
    }),
);

router.post(
    '/legal-documents',
    rbacGuard('hrga_legal', 'create'),
    validate({ body: v.legalDocumentCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.createLegalDocument(req.body, req.user),
        ));
    }),
);

router.put(
    '/legal-documents/:id',
    rbacGuard('hrga_legal', 'edit'),
    validate({ params: v.idParam, body: v.legalDocumentUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await hrga.updateLegalDocument(req.params.id, req.body, req.user),
        ));
    }),
);

router.post(
    '/legal-documents/:id/supersede',
    rbacGuard('hrga_legal', 'edit'),
    validate({ params: v.idParam, body: v.legalDocumentSupersede }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.supersedeLegalDocument(req.params.id, req.body, req.user),
        ));
    }),
);

router.post(
    '/legal-documents/:id/archive',
    rbacGuard('hrga_legal', 'edit'),
    validate({ params: v.idParam, body: v.archiveDocumentRequest }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.archiveLegalDocument(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/legal-documents/:id',
    rbacGuard('hrga_legal', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await hrga.deleteLegalDocument(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// COMPANY LETTERS  /api/hrga/company-letters
// ============================================================================

router.get(
    '/company-letters',
    rbacGuard('company_letters', 'view_own'),
    validate({ query: v.companyLetterListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.listCompanyLetters({
            query: req.query,
            scopeUserId: hrgaScopeUserId(req),
        });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/company-letters/:id',
    rbacGuard('company_letters', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await hrga.getCompanyLetter(req.params.id)));
    }),
);

router.post(
    '/company-letters',
    rbacGuard('company_letters', 'create'),
    validate({ body: v.companyLetterCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.createCompanyLetter(req.body, req.user),
        ));
    }),
);

router.put(
    '/company-letters/:id',
    rbacGuard('company_letters', 'edit'),
    validate({ params: v.idParam, body: v.companyLetterUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await hrga.updateCompanyLetter(req.params.id, req.body, req.user),
        ));
    }),
);

router.put(
    '/company-letters/:id/transition',
    rbacGuard('company_letters', 'edit'),
    validate({ params: v.idParam, body: v.companyLetterTransition }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await hrga.transitionCompanyLetter(req.params.id, req.body, req.user),
        ));
    }),
);

router.post(
    '/company-letters/:id/archive',
    rbacGuard('company_letters', 'edit'),
    validate({ params: v.idParam, body: v.archiveDocumentRequest }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.archiveCompanyLetter(req.params.id, req.body, req.user),
        ));
    }),
);

router.delete(
    '/company-letters/:id',
    rbacGuard('company_letters', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await hrga.deleteCompanyLetter(req.params.id, req.user);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// LETTER TEMPLATES  /api/hrga/letter-templates
// ============================================================================

router.get(
    '/letter-templates',
    rbacGuard('company_letters', 'view_own'),
    validate({ query: v.letterTemplateListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.listLetterTemplates({ query: req.query });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/letter-templates/:id',
    rbacGuard('company_letters', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await hrga.getLetterTemplate(req.params.id)));
    }),
);

router.post(
    '/letter-templates',
    rbacGuard('company_letters', 'create'),
    validate({ body: v.letterTemplateCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.createLetterTemplate(req.body, req.user),
        ));
    }),
);

router.put(
    '/letter-templates/:id',
    rbacGuard('company_letters', 'edit'),
    validate({ params: v.idParam, body: v.letterTemplateUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await hrga.updateLetterTemplate(req.params.id, req.body),
        ));
    }),
);

router.delete(
    '/letter-templates/:id',
    rbacGuard('company_letters', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await hrga.deleteLetterTemplate(req.params.id);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// ============================================================================
// ARCHIVE & REPOSITORY  /api/hrga/archive
// ============================================================================

router.get(
    '/archive',
    rbacGuard('hrga_archive', 'view_own'),
    validate({ query: v.archiveListQuery }),
    asyncHandler(async (req, res) => {
        const { rows, meta } = await hrga.listArchive({ query: req.query });
        res.json(success(rows, meta));
    }),
);

router.get(
    '/archive/:id',
    rbacGuard('hrga_archive', 'view_own'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        res.json(success(await hrga.getArchiveRecord(req.params.id)));
    }),
);

router.post(
    '/archive',
    rbacGuard('hrga_archive', 'create'),
    validate({ body: v.archiveCreate }),
    asyncHandler(async (req, res) => {
        res.status(201).json(success(
            await hrga.createArchive(req.body, req.user),
        ));
    }),
);

router.put(
    '/archive/:id',
    rbacGuard('hrga_archive', 'edit'),
    validate({ params: v.idParam, body: v.archiveUpdate }),
    asyncHandler(async (req, res) => {
        res.json(success(
            await hrga.updateArchive(req.params.id, req.body),
        ));
    }),
);

router.delete(
    '/archive/:id',
    rbacGuard('hrga_archive', 'delete'),
    validate({ params: v.idParam }),
    asyncHandler(async (req, res) => {
        await hrga.deleteArchive(req.params.id);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

module.exports = router;

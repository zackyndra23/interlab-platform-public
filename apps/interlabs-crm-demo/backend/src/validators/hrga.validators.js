'use strict';

const Joi = require('joi');

const uuid = Joi.string().uuid({ version: 'uuidv4' });

const idParam = Joi.object({ id: uuid.required() });

const listQuery = Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    search: Joi.string().max(200).allow('', null),
}).unknown(true);

const fileIds = Joi.array().items(uuid);
const tagList = Joi.array().items(Joi.string().max(100));

// ---------------------------------------------------------------------------
// LEGAL DOCUMENT STATUS / FLAG ENUMS — mirror migration 009 CHECK constraints.
// ---------------------------------------------------------------------------

const legalDocumentStatuses = [
    'Draft', 'Active', 'Expiring Soon', 'Expired', 'Superseded', 'Archived',
];
const complianceFlags = [
    'ok', 'expiring_soon_90', 'expiring_soon_30', 'expired',
];
const accessScopes = ['hrga_only', 'all_roles', 'specific_roles'];

// ---------------------------------------------------------------------------
// LEGALITAS (hrga_legal_documents)
// ---------------------------------------------------------------------------

const legalDocumentCoreOptional = {
    document_category: Joi.string().max(200).allow('', null),
    document_subcategory: Joi.string().max(200).allow('', null),
    document_number: Joi.string().max(200).allow('', null),
    document_year: Joi.number().integer().min(1900).max(9999).allow(null),
    issue_date: Joi.date().iso().allow(null),
    expiry_date: Joi.date().iso().allow(null),
    validity_period_start: Joi.date().iso().allow(null),
    validity_period_end: Joi.date().iso().allow(null),
    notary_name: Joi.string().max(300).allow('', null),
    related_customer_id: uuid.allow(null),
    related_principal: Joi.string().max(300).allow('', null),
    pic_user_id: uuid.allow(null),
    version_number: Joi.string().max(50).allow('', null),
    document_status: Joi.string().valid(...legalDocumentStatuses),
    tags: tagList,
    notes: Joi.string().allow('', null),
    access_scope: Joi.string().valid(...accessScopes),
    attachment_ids: fileIds,
};

const legalDocumentCreate = Joi.object({
    document_name: Joi.string().max(500).required(),
    ...legalDocumentCoreOptional,
});

const legalDocumentUpdate = Joi.object({
    document_name: Joi.string().max(500),
    ...legalDocumentCoreOptional,
}).min(1);

const legalDocumentListQuery = listQuery.keys({
    document_category: Joi.string().max(200),
    document_subcategory: Joi.string().max(200),
    document_status: Joi.string().valid(...legalDocumentStatuses),
    compliance_flag: Joi.string().valid(...complianceFlags),
    pic_user_id: uuid,
    related_customer_id: uuid,
    tag: Joi.string().max(100),
    year: Joi.number().integer().min(1900).max(9999),
});

// Versioning endpoint — supply the fields of the new Active version; the
// service will mark the current row Superseded and point superseded_by_id
// at the freshly inserted record.
const legalDocumentSupersede = Joi.object({
    document_name: Joi.string().max(500),
    ...legalDocumentCoreOptional,
    supersede_reason: Joi.string().max(2000).allow('', null),
}).min(1);

// Archive endpoint — declares a reason and optional notes. The service
// mirrors the row into hrga_archive_records and flips the source row's
// document_status to 'Archived'.
const archiveDocumentRequest = Joi.object({
    archive_reason: Joi.string().valid('Superseded', 'Expired', 'Withdrawn', 'Other').required(),
    notes: Joi.string().max(2000).allow('', null),
    access_scope: Joi.string().valid('hrga_only', 'all_roles'),
});

// ---------------------------------------------------------------------------
// COMPANY LETTERS
// ---------------------------------------------------------------------------

const letterStatuses = ['Draft', 'Under Review', 'Final', 'Sent', 'Archived'];
const letterAccessScopes = ['hrga_only', 'all_roles', 'specific_roles'];

const companyLetterCoreOptional = {
    letter_type: Joi.string().max(200).allow('', null),
    letter_number: Joi.string().max(200).allow('', null),
    related_employee_id: uuid.allow(null),
    recipient_name: Joi.string().max(300).allow('', null),
    recipient_role_or_department: Joi.string().max(200).allow('', null),
    issue_date: Joi.date().iso().allow(null),
    effective_date: Joi.date().iso().allow(null),
    reference_number: Joi.string().max(200).allow('', null),
    signatory_user_id: uuid.allow(null),
    template_reference_id: uuid.allow(null),
    letter_status: Joi.string().valid(...letterStatuses),
    tags: tagList,
    notes: Joi.string().allow('', null),
    access_scope: Joi.string().valid(...letterAccessScopes),
    attachment_ids: fileIds,
};

const companyLetterCreate = Joi.object({
    subject: Joi.string().max(500).required(),
    ...companyLetterCoreOptional,
});

const companyLetterUpdate = Joi.object({
    subject: Joi.string().max(500),
    ...companyLetterCoreOptional,
}).min(1);

const companyLetterListQuery = listQuery.keys({
    letter_status: Joi.string().valid(...letterStatuses),
    letter_type: Joi.string().max(200),
    signatory_user_id: uuid,
    related_employee_id: uuid,
});

// Dedicated transition endpoint — lets an HRGA user submit a review request
// or finalize without re-uploading every field.
const companyLetterTransition = Joi.object({
    letter_status: Joi.string().valid(...letterStatuses).required(),
    note: Joi.string().max(2000).allow('', null),
});

// ---------------------------------------------------------------------------
// LETTER TEMPLATES
// ---------------------------------------------------------------------------

const letterTemplateCreate = Joi.object({
    template_name: Joi.string().max(300).required(),
    letter_type: Joi.string().max(200).required(),
    body_html: Joi.string().required(),
});

const letterTemplateUpdate = Joi.object({
    template_name: Joi.string().max(300),
    letter_type: Joi.string().max(200),
    body_html: Joi.string(),
}).min(1);

const letterTemplateListQuery = listQuery.keys({
    letter_type: Joi.string().max(200),
});

// ---------------------------------------------------------------------------
// ARCHIVE
// ---------------------------------------------------------------------------

const archiveReasons = ['Superseded', 'Expired', 'Withdrawn', 'Other'];
const archiveAccessScopes = ['hrga_only', 'all_roles'];
const archiveSourceModules = ['legalitas', 'company_letters', 'other'];

const archiveCreate = Joi.object({
    source_module: Joi.string().valid(...archiveSourceModules).required(),
    source_record_id: uuid.required(),
    document_name: Joi.string().max(500).allow('', null),
    document_category: Joi.string().max(200).allow('', null),
    archive_reason: Joi.string().valid(...archiveReasons).required(),
    notes: Joi.string().max(2000).allow('', null),
    access_scope: Joi.string().valid(...archiveAccessScopes),
    attachment_ids: fileIds,
});

const archiveUpdate = Joi.object({
    document_name: Joi.string().max(500).allow('', null),
    document_category: Joi.string().max(200).allow('', null),
    archive_reason: Joi.string().valid(...archiveReasons),
    notes: Joi.string().max(2000).allow('', null),
    access_scope: Joi.string().valid(...archiveAccessScopes),
}).min(1);

const archiveListQuery = listQuery.keys({
    source_module: Joi.string().valid(...archiveSourceModules),
    archive_reason: Joi.string().valid(...archiveReasons),
});

// ---------------------------------------------------------------------------
// SMART SEARCH
// ---------------------------------------------------------------------------

const smartSearchQuery = Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    keyword: Joi.string().max(300).allow('', null),
    document_category: Joi.string().max(200),
    document_subcategory: Joi.string().max(200),
    document_number: Joi.string().max(200),
    year: Joi.number().integer().min(1900).max(9999),
    issue_date_from: Joi.date().iso(),
    issue_date_to: Joi.date().iso(),
    expiry_date_from: Joi.date().iso(),
    expiry_date_to: Joi.date().iso(),
    pic_user_id: uuid,
    related_employee_id: uuid,
    related_customer_id: uuid,
    notary_name: Joi.string().max(300),
    status: Joi.string().valid(
        ...legalDocumentStatuses, ...letterStatuses,
    ),
    tag: Joi.string().max(100),
    include_archive: Joi.boolean(),
}).unknown(false);

// ---------------------------------------------------------------------------
// COMPLIANCE
// ---------------------------------------------------------------------------

const complianceExpiringQuery = Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    within_days: Joi.number().integer().min(1).max(720).default(90),
    compliance_flag: Joi.string().valid(...complianceFlags),
});

module.exports = {
    idParam,

    legalDocumentCreate,
    legalDocumentUpdate,
    legalDocumentListQuery,
    legalDocumentSupersede,
    archiveDocumentRequest,

    companyLetterCreate,
    companyLetterUpdate,
    companyLetterListQuery,
    companyLetterTransition,

    letterTemplateCreate,
    letterTemplateUpdate,
    letterTemplateListQuery,

    archiveCreate,
    archiveUpdate,
    archiveListQuery,

    smartSearchQuery,
    complianceExpiringQuery,
};

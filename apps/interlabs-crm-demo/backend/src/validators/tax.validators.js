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

// ---------------------------------------------------------------------------
// ENUMS — mirror migration 010 CHECK constraints
// ---------------------------------------------------------------------------

const taxTypes = ['PPh 21', 'PPh 25', 'PPN', 'Others'];
const taxCategories = ['SSP Payment', 'SPT Reporting', 'Combined Record'];
const jenisSpt = ['SPT Tahunan', 'SPT Masa'];
const statusSpt = ['Normal', 'Pembetulan'];
const paymentStatuses = ['Unpaid', 'Paid', 'Pending', 'Failed'];
const recordStatuses = ['Draft', 'Submitted', 'Verified', 'Archived'];
const currencies = ['IDR', 'USD', 'EUR'];

// NPWP: Indonesian tax ID. Historically 15 digits (with or without dots /
// dashes as separators, e.g. "01.234.567.8-901.000"). As of the Coretax
// rollout (2024/2025) a 16-digit variant is also in use for individuals.
// Accept 15 OR 16 digits once separators are stripped, to keep the field
// forward-compatible without loosening it to free text.
const npwpValidator = Joi.string().custom((value, helpers) => {
    if (value === null || value === undefined || value === '') return value;
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length !== 15 && digits.length !== 16) {
        return helpers.error('any.invalid');
    }
    return value;
}, 'NPWP 15- or 16-digit check').messages({
    'any.invalid': 'npwp must contain 15 or 16 digits (ignoring separators)',
});

// ---------------------------------------------------------------------------
// CONDITIONAL FIELD LOGIC (MOD_tax_insurance §Conditional Field Logic)
//
// tax_category = 'SSP Payment'     → disallow SPT fields
// tax_category = 'SPT Reporting'   → disallow SSP fields
// tax_category = 'Combined Record' → all fields allowed
//
// Implemented with Joi `when()` so the API rejects payloads that carry
// fields the record type shouldn't persist, matching the frontend's field
// hiding. Service layer applies the same gate as a defense-in-depth step.
// ---------------------------------------------------------------------------

const sptFieldsOnlyForReporting = {
    jenis_spt: Joi.when('tax_category', {
        is: 'SSP Payment',
        then: Joi.forbidden(),
        otherwise: Joi.string().valid(...jenisSpt).allow(null),
    }),
    status_spt: Joi.when('tax_category', {
        is: 'SSP Payment',
        then: Joi.forbidden(),
        otherwise: Joi.string().valid(...statusSpt).allow(null),
    }),
    reporting_date: Joi.when('tax_category', {
        is: 'SSP Payment',
        then: Joi.forbidden(),
        otherwise: Joi.date().iso().allow(null),
    }),
    attachment_spt_file_ids: Joi.when('tax_category', {
        is: 'SSP Payment',
        then: Joi.forbidden(),
        otherwise: fileIds,
    }),
};

const sspFieldsOnlyForPayment = {
    billing_code: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().max(200).allow('', null),
    }),
    ntpn: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().max(200).allow('', null),
    }),
    ntb: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().max(200).allow('', null),
    }),
    stan: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().max(200).allow('', null),
    }),
    bank_name: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().max(200).allow('', null),
    }),
    payment_date: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.date().iso().allow(null),
    }),
    amount: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.number().min(0).allow(null),
    }),
    currency: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: Joi.string().valid(...currencies),
    }),
    attachment_ssp_file_ids: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: fileIds,
    }),
    attachment_payment_file_ids: Joi.when('tax_category', {
        is: 'SPT Reporting',
        then: Joi.forbidden(),
        otherwise: fileIds,
    }),
};

// ---------------------------------------------------------------------------
// CREATE / UPDATE
// ---------------------------------------------------------------------------

const baseFields = {
    // tax period: masa_pajak is stored as date (first-of-month); the service
    // derives masa_pajak_month + masa_pajak_year from it. Callers may also
    // send month+year directly for month-picker UIs without a full date.
    masa_pajak: Joi.date().iso().allow(null),
    masa_pajak_month: Joi.number().integer().min(1).max(12).allow(null),
    masa_pajak_year: Joi.number().integer().min(2000).max(2100).allow(null),
    tahun_pajak: Joi.number().integer().min(2000).max(2100).allow(null),

    // taxpayer identity
    taxpayer_name: Joi.string().max(500).allow('', null),
    taxpayer_address: Joi.string().allow('', null),

    // status & assignment
    payment_status: Joi.string().valid(...paymentStatuses),
    record_status: Joi.string().valid(...recordStatuses),
    pic_user_id: uuid.allow(null),
    notes: Joi.string().allow('', null),

    attachment_supporting_file_ids: fileIds,
    ...sptFieldsOnlyForReporting,
    ...sspFieldsOnlyForPayment,
};

const taxOperationalCreate = Joi.object({
    tax_type: Joi.string().valid(...taxTypes).required(),
    tax_category: Joi.string().valid(...taxCategories).required(),
    npwp: npwpValidator.required(),
    ...baseFields,
});

// Update: tax_type / tax_category may be omitted. When tax_category IS
// present, the SPT/SSP gates apply as on create. When tax_category is
// absent, the service layer re-checks against the stored category so a
// caller can't sneak a SPT field into an SSP-only record by omitting
// tax_category from the PUT body.
const taxOperationalUpdate = Joi.object({
    tax_type: Joi.string().valid(...taxTypes),
    tax_category: Joi.string().valid(...taxCategories),
    npwp: npwpValidator,
    ...baseFields,
}).min(1);

// Dedicated status-change endpoint — separate from the general update so
// the audit log action code is unambiguous (status_changed vs. updated).
const taxOperationalStatusChange = Joi.object({
    record_status: Joi.string().valid(...recordStatuses),
    payment_status: Joi.string().valid(...paymentStatuses),
    payment_date: Joi.date().iso().allow(null),
    reporting_date: Joi.date().iso().allow(null),
    note: Joi.string().max(2000).allow('', null),
}).min(1);

// ---------------------------------------------------------------------------
// LIST / FILTER
// ---------------------------------------------------------------------------

const taxOperationalListQuery = listQuery.keys({
    tax_type: Joi.string().valid(...taxTypes),
    tax_category: Joi.string().valid(...taxCategories),
    record_status: Joi.string().valid(...recordStatuses),
    payment_status: Joi.string().valid(...paymentStatuses),
    pic_user_id: uuid,
    npwp: Joi.string().max(50),
    masa_pajak_month: Joi.number().integer().min(1).max(12),
    masa_pajak_year: Joi.number().integer().min(2000).max(2100),
    tahun_pajak: Joi.number().integer().min(2000).max(2100),
    masa_pajak_from: Joi.date().iso(),
    masa_pajak_to: Joi.date().iso(),
});

const taxAuditListQuery = listQuery.keys({
    action: Joi.string().valid('created', 'updated', 'status_changed', 'archived'),
    actor_user_id: uuid,
    from: Joi.date().iso(),
    to: Joi.date().iso(),
});

const dashboardQuery = Joi.object({
    tahun_pajak: Joi.number().integer().min(2000).max(2100),
    months: Joi.number().integer().min(1).max(24).default(12),
});

module.exports = {
    idParam,
    taxOperationalCreate,
    taxOperationalUpdate,
    taxOperationalStatusChange,
    taxOperationalListQuery,
    taxAuditListQuery,
    dashboardQuery,
};

'use strict';

const Joi = require('joi');

// Shared primitives match the Sales validator conventions so the two modules
// compose predictably when Sales auto-creates Finance rows.
const uuid = Joi.string().uuid({ version: 'uuidv4' });
const currency = Joi.string().valid('IDR', 'USD', 'EUR');
const amount = Joi.number().min(0).precision(2);
const percent = Joi.number().min(0).max(100).precision(2);
const exchangeRate = Joi.number().min(0).precision(6);

const idParam = Joi.object({ id: uuid.required() });

const listQuery = Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    search: Joi.string().max(200).allow('', null),
}).unknown(true);

const itemListEntry = Joi.object({
    item_name: Joi.string().max(500).required(),
    description: Joi.string().allow('', null),
    qty: Joi.number().min(0),
    unit: Joi.string().max(50).allow('', null),
    unit_price: amount,
    subtotal_per_item: amount,
    total_price: amount,
}).unknown(true);
const itemList = Joi.array().items(itemListEntry);

const attachmentIds = Joi.array().items(uuid).min(1);
const optionalAttachmentIds = Joi.array().items(uuid);

// ---------------------------------------------------------------------------
// PO CUSTOMER
//   No create endpoint — rows are auto-created by sales.service.submitSalesPo.
//   Only updates are exposed.
// ---------------------------------------------------------------------------

const poCustomerWorkflow = ['registered', 'active', 'invoiced', 'completed'];

const poCustomerCore = {
    po_customer_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    version: Joi.string().max(50).allow('', null),
    order_date: Joi.date().iso().allow(null),
    quotation_reference_id: uuid.allow(null),
    payment_term_condition: Joi.string().max(200).allow('', null),
    delivery_term: Joi.string().max(200).allow('', null),
    term_of_payment: Joi.string().max(200).allow('', null),
    warranty: Joi.string().allow('', null),
    penalty_clause: Joi.string().allow('', null),
    bill_to: Joi.string().allow('', null),
    ship_to: Joi.string().allow('', null),
    currency,
    item_list: itemList,
    subtotal: amount.allow(null),
    tax_percent: percent.allow(null),
    tax_amount: amount.allow(null),
    total_amount: amount.allow(null),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const poCustomerUpdate = Joi.object(poCustomerCore).min(1);
const poCustomerListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...poCustomerWorkflow),
});

// ---------------------------------------------------------------------------
// PURCHASE REQUISITION
//   Auto-created by sales.service.submitSalesPr. Finance edits header, then
//   calls /upload-po-out to flip status → Processed (advances master PO to
//   Production).
// ---------------------------------------------------------------------------

const requisitionCore = {
    related_po_customer_id: uuid.allow(null),
    customer_id: uuid.allow(null),
    supplier_or_manufacturer: Joi.string().max(500).allow('', null),
    manufacturer_contact_person: Joi.string().max(500).allow('', null),
    manufacturer_email: Joi.string().email().allow('', null),
    pr_number: Joi.string().max(200).allow('', null),
    pr_date: Joi.date().iso().allow(null),
    currency,
    item_list: itemList,
    incoterm: Joi.string().max(50).allow('', null),
    delivery_time: Joi.string().max(200).allow('', null),
    payment_term: Joi.string().max(200).allow('', null),
    shipping_address: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const requisitionUpdate = Joi.object(requisitionCore).min(1);

// All three trigger inputs are required together; service also cross-checks
// that no prior po_out_number is set (idempotency).
const requisitionUploadPoOut = Joi.object({
    po_out_number: Joi.string().min(1).max(200).required(),
    po_out_date: Joi.date().iso().required(),
    attachment_ids: attachmentIds.required(),
    note: Joi.string().max(2000).allow('', null),
});

const requisitionListQuery = listQuery.keys({
    current_pr_status: Joi.string().valid('Registered', 'Processed'),
});

// ---------------------------------------------------------------------------
// INVOICE MANUFACTURE
// ---------------------------------------------------------------------------

const invoiceManufactureCore = {
    related_pr_id: uuid.allow(null),
    related_po_out_number: Joi.string().max(200).allow('', null),
    related_po_id: uuid.allow(null),
    supplier_or_manufacturer: Joi.string().max(500).allow('', null),
    invoice_number: Joi.string().max(200).allow('', null),
    invoice_date: Joi.date().iso().allow(null),
    due_date: Joi.date().iso().allow(null),
    payment_terms: Joi.string().max(200).allow('', null),
    preferred_shipping: Joi.string().max(200).allow('', null),
    incoterm: Joi.string().max(50).allow('', null),
    currency,
    exchange_rate: exchangeRate.allow(null),
    item_list: itemList,
    untaxed_amount: amount.allow(null),
    vat_percent: percent.allow(null),
    vat_amount: amount.allow(null),
    total_amount: amount.allow(null),
    bank_name: Joi.string().max(200).allow('', null),
    iban_or_account_number: Joi.string().max(200).allow('', null),
    bic_swift: Joi.string().max(50).allow('', null),
    transaction_reference: Joi.string().max(200).allow('', null),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const invoiceManufactureCreate = Joi.object(invoiceManufactureCore);
const invoiceManufactureUpdate = Joi.object(invoiceManufactureCore).min(1);

const invoiceManufactureUploadPayment = Joi.object({
    payment_date: Joi.date().iso().required(),
    payment_amount: amount.required(),
    transaction_reference: Joi.string().max(200).allow('', null),
    attachment_ids: attachmentIds.required(),
    note: Joi.string().max(2000).allow('', null),
});

const invoiceManufactureListQuery = listQuery.keys({
    payment_status: Joi.string().valid('Unpaid', 'Paid'),
});

// ---------------------------------------------------------------------------
// INVOICE CUSTOMER
//   Draft auto-created by Technical BAST upload. /upload-invoice flips the
//   status to Processed + advances master PO to Invoice.
// ---------------------------------------------------------------------------

const invoiceCustomerCore = {
    related_po_customer_id: uuid.allow(null),
    related_bast_id: uuid.allow(null),
    related_do_id: uuid.allow(null),
    related_po_id: uuid.allow(null),
    customer_id: uuid.allow(null),
    invoice_date: Joi.date().iso().allow(null),
    customer_order_number: Joi.string().max(200).allow('', null),
    order_date: Joi.date().iso().allow(null),
    currency,
    shipping_method: Joi.string().max(200).allow('', null),
    item_list: itemList,
    subtotal: amount.allow(null),
    discount_amount: amount.allow(null),
    tax_base: amount.allow(null),
    vat_percent: percent.allow(null),
    vat_amount: amount.allow(null),
    total_amount: amount.allow(null),
    billing_account_info: Joi.string().allow('', null),
    payment_due_date: Joi.date().iso().allow(null),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const invoiceCustomerUpdate = Joi.object(invoiceCustomerCore).min(1);

const invoiceCustomerUploadInvoice = Joi.object({
    invoice_number: Joi.string().min(1).max(200).required(),
    invoice_date: Joi.date().iso(),
    attachment_ids: attachmentIds.required(),
    note: Joi.string().max(2000).allow('', null),
});

const invoiceCustomerListQuery = listQuery.keys({
    invoice_status: Joi.string().valid('Registered', 'Processed'),
});

module.exports = {
    idParam,

    poCustomerUpdate, poCustomerListQuery,

    requisitionUpdate, requisitionUploadPoOut, requisitionListQuery,

    invoiceManufactureCreate, invoiceManufactureUpdate,
    invoiceManufactureUploadPayment, invoiceManufactureListQuery,

    invoiceCustomerUpdate, invoiceCustomerUploadInvoice, invoiceCustomerListQuery,
};

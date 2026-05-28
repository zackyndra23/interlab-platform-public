'use strict';

const Joi = require('joi');

// Shared primitives -----------------------------------------------------------

const uuid = Joi.string().uuid({ version: 'uuidv4' });
const currency = Joi.string().valid('IDR', 'USD', 'EUR');
const amount = Joi.number().min(0).precision(2);
const percent = Joi.number().min(0).max(100).precision(2);

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
    total_price: amount,
    // extra bookkeeping fields that different forms carry:
    cost_price: amount,
    selling_price: amount,
    margin_amount: amount,
    margin_percent: percent,
}).unknown(true);

const itemList = Joi.array().items(itemListEntry);

// ---------------------------------------------------------------------------
// CUSTOMERS
// ---------------------------------------------------------------------------

const customerCore = {
    company_name: Joi.string().max(500),
    trade_name: Joi.string().max(500).allow('', null),
    address: Joi.string().allow('', null),
    city: Joi.string().max(200).allow('', null),
    country: Joi.string().max(200).allow('', null),
    phone: Joi.string().max(100).allow('', null),
    email: Joi.string().email().allow('', null),
    website: Joi.string().uri({ scheme: ['http', 'https'] }).allow('', null),
    npwp: Joi.string().max(100).allow('', null),
    pic_name: Joi.string().max(200).allow('', null),
    pic_phone: Joi.string().max(100).allow('', null),
    pic_email: Joi.string().email().allow('', null),
    customer_status: Joi.string().valid('Active', 'Inactive'),
    notes: Joi.string().allow('', null),
};

const customerCreate = Joi.object({
    ...customerCore,
    company_name: Joi.string().max(500).required(),
});

const customerUpdate = Joi.object(customerCore).min(1);

const customerListQuery = listQuery.keys({
    status: Joi.string().valid('Active', 'Inactive'),
});

// ---------------------------------------------------------------------------
// SALES FORECAST
// ---------------------------------------------------------------------------

const forecastStages = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const forecastCore = {
    customer_id: uuid.allow(null),
    product_or_service_name: Joi.string().max(500),
    description: Joi.string().allow('', null),
    forecast_period_start: Joi.date().iso().allow(null),
    forecast_period_end: Joi.date().iso().allow(null),
    currency,
    estimated_value: amount.allow(null),
    probability_percent: percent.allow(null),
    stage: Joi.string().valid(...forecastStages),
    expected_close_date: Joi.date().iso().allow(null),
    pic_user_id: uuid.allow(null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid('draft', 'submitted', 'closed'),
    current_step: Joi.string().max(100).allow('', null),
};

const forecastCreate = Joi.object({
    ...forecastCore,
    product_or_service_name: Joi.string().max(500).required(),
});

const forecastUpdate = Joi.object(forecastCore).min(1);

const forecastListQuery = listQuery.keys({
    stage: Joi.string().valid(...forecastStages),
});

// ---------------------------------------------------------------------------
// QUOTATIONS
// ---------------------------------------------------------------------------

const quotationWorkflow = ['draft', 'submitted', 'revised', 'accepted', 'rejected'];

const quotationCore = {
    quotation_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    related_forecast_id: uuid.allow(null),
    quotation_date: Joi.date().iso().allow(null),
    validity_date: Joi.date().iso().allow(null),
    currency,
    item_list: itemList,
    subtotal: amount.allow(null),
    discount_percent: percent.allow(null),
    discount_amount: amount.allow(null),
    tax_percent: percent.allow(null),
    tax_amount: amount.allow(null),
    total_amount: amount.allow(null),
    payment_terms: Joi.string().max(200).allow('', null),
    delivery_terms: Joi.string().max(200).allow('', null),
    warranty_terms: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...quotationWorkflow),
    current_step: Joi.string().max(100).allow('', null),
};

const quotationCreate = Joi.object(quotationCore);
const quotationUpdate = Joi.object(quotationCore).min(1);
const quotationTransition = Joi.object({
    workflow_status: Joi.string()
        .valid('submitted', 'revised', 'accepted', 'rejected')
        .required(),
});
const quotationListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...quotationWorkflow),
});

// ---------------------------------------------------------------------------
// HARGA POKOK PENJUALAN
// ---------------------------------------------------------------------------

const hppWorkflow = ['draft', 'submitted', 'approved'];

const hppCore = {
    customer_id: uuid.allow(null),
    related_quotation_id: uuid.allow(null),
    hpp_date: Joi.date().iso().allow(null),
    currency,
    item_list: itemList,
    total_cost: amount.allow(null),
    total_selling_price: amount.allow(null),
    gross_margin_total: amount.allow(null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...hppWorkflow),
    current_step: Joi.string().max(100).allow('', null),
};

const hppCreate = Joi.object(hppCore);
const hppUpdate = Joi.object(hppCore).min(1);
const hppTransition = Joi.object({
    workflow_status: Joi.string().valid('submitted', 'approved').required(),
});
const hppListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...hppWorkflow),
});

// ---------------------------------------------------------------------------
// SALES PURCHASE ORDER
// ---------------------------------------------------------------------------

const salesPoWorkflow = ['draft', 'submitted', 'processed', 'overdue'];

const salesPoCore = {
    po_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    related_quotation_id: uuid.allow(null),
    order_date: Joi.date().iso().allow(null),
    delivery_deadline: Joi.date().iso().allow(null),
    currency,
    payment_terms: Joi.string().max(200).allow('', null),
    delivery_terms: Joi.string().max(200).allow('', null),
    item_list: itemList,
    subtotal: amount.allow(null),
    tax_amount: amount.allow(null),
    total_amount: amount.allow(null),
    notes: Joi.string().allow('', null),
    current_step: Joi.string().max(100).allow('', null),
};

const salesPoCreate = Joi.object(salesPoCore);
const salesPoUpdate = Joi.object(salesPoCore).min(1);
const salesPoProcess = Joi.object({
    note: Joi.string().max(2000).allow('', null),
});
const salesPoOverdueReason = Joi.object({
    reason: Joi.string().min(3).max(2000).required(),
    attachment_id: uuid.allow(null),
});
const salesPoListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...salesPoWorkflow),
});

// ---------------------------------------------------------------------------
// SALES PR
// ---------------------------------------------------------------------------

const salesPrWorkflow = ['draft', 'submitted', 'copied_to_finance'];

const salesPrCore = {
    related_po_id: uuid.allow(null),
    customer_id: uuid.allow(null),
    supplier_or_manufacturer: Joi.string().max(500).allow('', null),
    manufacturer_contact: Joi.string().max(500).allow('', null),
    manufacturer_email: Joi.string().email().allow('', null),
    pr_date: Joi.date().iso().allow(null),
    currency,
    item_list: itemList,
    incoterm: Joi.string().max(50).allow('', null),
    delivery_time: Joi.string().max(200).allow('', null),
    payment_terms: Joi.string().max(200).allow('', null),
    shipping_address: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
    current_step: Joi.string().max(100).allow('', null),
};

const salesPrCreate = Joi.object(salesPrCore);
const salesPrUpdate = Joi.object(salesPrCore).min(1);
const salesPrListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...salesPrWorkflow),
});

module.exports = {
    idParam,

    customerCreate, customerUpdate, customerListQuery,

    forecastCreate, forecastUpdate, forecastListQuery,

    quotationCreate, quotationUpdate, quotationTransition, quotationListQuery,

    hppCreate, hppUpdate, hppTransition, hppListQuery,

    salesPoCreate, salesPoUpdate, salesPoProcess, salesPoOverdueReason, salesPoListQuery,

    salesPrCreate, salesPrUpdate, salesPrListQuery,
};

'use strict';

const Joi = require('joi');

// Shared primitives — aligned with the Sales and Finance validator styles so
// payloads compose consistently across modules.

const uuid = Joi.string().uuid({ version: 'uuidv4' });
const currency = Joi.string().valid('IDR', 'USD', 'EUR');
const amount = Joi.number().min(0).precision(2);

const idParam = Joi.object({ id: uuid.required() });

const listQuery = Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    search: Joi.string().max(200).allow('', null),
}).unknown(true);

const attachmentIds = Joi.array().items(uuid).min(1);
const optionalAttachmentIds = Joi.array().items(uuid);

const itemListEntry = Joi.object({
    item_name: Joi.string().max(500).required(),
    description: Joi.string().allow('', null),
    qty: Joi.number().min(0),
    unit: Joi.string().max(50).allow('', null),
}).unknown(true);
const itemList = Joi.array().items(itemListEntry);

// ---------------------------------------------------------------------------
// AIRWAY BILL (AWB)
// ---------------------------------------------------------------------------

const shipmentMethods = ['Air', 'Sea', 'Land', 'Courier'];
const awbStatuses = ['Registered', 'Processed', 'Arrived'];

const awbCoreOptional = {
    related_po_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    supplier_or_manufacturer: Joi.string().max(500).allow('', null),
    forwarder_or_courier: Joi.string().max(500).allow('', null),
    awb_tracking_number: Joi.string().max(200).allow('', null),
    shipment_method: Joi.string().valid(...shipmentMethods).allow(null),
    origin_country: Joi.string().max(200).allow('', null),
    transit_country_or_hub: Joi.string().max(200).allow('', null),
    destination: Joi.string().max(200).allow('', null),
    despatch_date: Joi.date().iso().allow(null),
    transit_date: Joi.date().iso().allow(null),
    arrival_date: Joi.date().iso().allow(null),
    weight_kg: Joi.number().min(0).precision(3).allow(null),
    package_count: Joi.number().integer().min(0).allow(null),
    description_of_goods: Joi.string().allow('', null),
    incoterm: Joi.string().max(50).allow('', null),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const awbCreate = Joi.object({
    related_po_id: uuid.required(),
    ...awbCoreOptional,
});

const awbUpdate = Joi.object({
    related_po_id: uuid,
    ...awbCoreOptional,
}).min(1);

const awbListQuery = listQuery.keys({
    current_awb_status: Joi.string().valid(...awbStatuses),
    related_po_id: uuid,
});

// ---------------------------------------------------------------------------
// DELIVERY ORDER (DO)
// ---------------------------------------------------------------------------

const doStatuses = ['Registered', 'Arrived'];

const deliveryOrderCoreOptional = {
    related_po_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    delivery_order_number: Joi.string().max(200).allow('', null),
    delivery_date: Joi.date().iso().allow(null),
    shipping_method: Joi.string().max(200).allow('', null),
    courier_or_expedition_vendor: Joi.string().max(500).allow('', null),
    dispatch_from: Joi.string().max(500).allow('', null),
    delivery_address: Joi.string().allow('', null),
    invoicing_address: Joi.string().allow('', null),
    item_list: itemList,
    technical_inspection_reference_date: Joi.date().iso().allow(null),
    customer_arrival_date: Joi.date().iso().allow(null),
    remarks: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const deliveryOrderCreate = Joi.object({
    related_po_id: uuid.required(),
    ...deliveryOrderCoreOptional,
});

const deliveryOrderUpdate = Joi.object({
    related_po_id: uuid,
    ...deliveryOrderCoreOptional,
}).min(1);

const deliveryOrderListQuery = listQuery.keys({
    current_do_status: Joi.string().valid(...doStatuses),
    related_po_id: uuid,
});

// ---------------------------------------------------------------------------
// OPERATIONAL (Petty Cash)
// ---------------------------------------------------------------------------

const paymentMethods = ['Cash', 'Transfer', 'Credit Card'];
const expenseStatuses = ['Pending', 'Paid', 'Cancelled'];
const operationalWorkflow = ['draft', 'submitted', 'reviewed'];

const operationalCore = {
    reporting_month: Joi.date().iso(),
    department: Joi.string().max(200).allow('', null),
    expense_category: Joi.string().max(200).allow('', null),
    expense_subcategory: Joi.string().max(200).allow('', null),
    transaction_date: Joi.date().iso().allow(null),
    period_start: Joi.date().iso().allow(null),
    period_end: Joi.date().iso().allow(null),
    vendor_or_payee: Joi.string().max(500).allow('', null),
    related_po_id: uuid.allow(null),
    description: Joi.string().allow('', null),
    currency,
    amount: amount.allow(null),
    payment_method: Joi.string().valid(...paymentMethods).allow(null),
    expense_status: Joi.string().valid(...expenseStatuses),
    notes: Joi.string().allow('', null),
    attachment_ids: optionalAttachmentIds,
};

const operationalCreate = Joi.object({
    ...operationalCore,
    reporting_month: Joi.date().iso().required(),
});

const operationalUpdate = Joi.object(operationalCore).min(1);

const operationalTransition = Joi.object({
    workflow_status: Joi.string().valid('submitted', 'reviewed').required(),
});

const operationalListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...operationalWorkflow),
    expense_status: Joi.string().valid(...expenseStatuses),
    expense_category: Joi.string().max(200),
    reporting_month: Joi.date().iso(),
});

// ---------------------------------------------------------------------------
// READY-TO-DELIVER RESPONSE
// ---------------------------------------------------------------------------

const readyToDeliverAcknowledge = Joi.object({
    response_status: Joi.string().valid('acknowledged', 'dispatched').required(),
    delivery_method: Joi.string().valid('Pick Up Forwarder', 'Hand Carry').allow(null),
    note: Joi.string().max(2000).allow('', null),
});

const readyToDeliverListQuery = listQuery.keys({
    admin_log_response_status: Joi.string().valid('pending', 'acknowledged', 'dispatched'),
});

module.exports = {
    idParam,

    awbCreate, awbUpdate, awbListQuery,

    deliveryOrderCreate, deliveryOrderUpdate, deliveryOrderListQuery,

    operationalCreate, operationalUpdate, operationalTransition, operationalListQuery,

    readyToDeliverAcknowledge, readyToDeliverListQuery,
};

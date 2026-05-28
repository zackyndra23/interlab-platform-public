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
const uuidList = Joi.array().items(uuid);

// ---------------------------------------------------------------------------
// JOB ORDER
// ---------------------------------------------------------------------------

const jobTypes = ['Installation', 'PM', 'Sparepart'];
const priorities = ['Low', 'Medium', 'High', 'Critical'];
const jobOrderWorkflow = ['draft', 'active', 'completed', 'cancelled'];

const jobOrderCoreOptional = {
    related_po_number: Joi.string().max(200).allow('', null),
    customer_id: uuid.allow(null),
    planned_start_date: Joi.date().iso().allow(null),
    planned_end_date: Joi.date().iso().allow(null),
    work_duration_start: Joi.date().iso().allow(null),
    work_duration_end: Joi.date().iso().allow(null),
    assigned_engineer_id: uuid.allow(null),
    support_team_members: uuidList,
    site_location: Joi.string().allow('', null),
    product_or_equipment_name: Joi.string().max(500).allow('', null),
    serial_number: Joi.string().max(200).allow('', null),
    priority: Joi.string().valid(...priorities).allow(null),
    current_technical_status: Joi.string().max(200).allow('', null),
    po_due_date: Joi.date().iso().allow(null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...jobOrderWorkflow),
    attachment_ids: fileIds,
};

const jobOrderCreate = Joi.object({
    related_po_id: uuid.required(),
    job_type: Joi.string().valid(...jobTypes).required(),
    ...jobOrderCoreOptional,
});

const jobOrderUpdate = Joi.object({
    related_po_id: uuid,
    job_type: Joi.string().valid(...jobTypes),
    ...jobOrderCoreOptional,
}).min(1);

const jobOrderListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...jobOrderWorkflow),
    job_type: Joi.string().valid(...jobTypes),
    assigned_engineer_id: uuid,
    related_po_id: uuid,
    due_date_reminder_flag: Joi.boolean(),
});

// ---------------------------------------------------------------------------
// INSTALLATION
// ---------------------------------------------------------------------------

const yesNo = Joi.string().valid('Yes', 'No');
const workflowPhases = [
    'pre_installation', 'workshop', 'ready_to_deliver',
    'scheduling', 'on_site', 'commissioning', 'completed',
];
const deliveryMethods = ['Pick Up Forwarder', 'Hand Carry'];
const adminLogResponse = ['pending', 'acknowledged', 'dispatched'];

const installationCoreOptional = {
    related_po_id: uuid.allow(null),
    pre_installation_status: Joi.string().valid('Pending', 'In Progress', 'Complete'),
    local_part_request_needed: yesNo.allow(null),
    local_part_request_reference: Joi.string().max(500).allow('', null),
    finance_local_part_status: Joi.string().max(200).allow('', null),
    workshop_check_status: Joi.string().valid('Pending', 'In Progress', 'Passed', 'Failed'),
    inspection_status: Joi.string().valid('Pending', 'In Progress', 'Complete'),
    document_completeness_status: Joi.string().valid('Complete', 'Incomplete').allow(null),
    function_test_status: Joi.string().valid('Pending', 'Pass', 'Fail'),
    ready_to_deliver: yesNo.allow(null),
    delivery_method: Joi.string().valid(...deliveryMethods).allow(null),
    admin_log_response_status: Joi.string().valid(...adminLogResponse),
    ready_to_deliver_at: Joi.date().iso().allow(null),
    installation_schedule_date: Joi.date().iso().allow(null),
    installation_start_date: Joi.date().iso().allow(null),
    installation_end_date: Joi.date().iso().allow(null),
    commissioning_included: yesNo.allow(null),
    training_included: yesNo.allow(null),
    workflow_phase: Joi.string().valid(...workflowPhases),
    notes: Joi.string().allow('', null),
    qc_form_file_ids: fileIds,
    bast_upload_file_ids: fileIds,
};

const installationCreate = Joi.object({
    related_job_order_id: uuid.required(),
    ...installationCoreOptional,
});

const installationUpdate = Joi.object(installationCoreOptional).min(1);

const readyToDeliverRequest = Joi.object({
    delivery_method: Joi.string().valid(...deliveryMethods).required(),
    note: Joi.string().max(2000).allow('', null),
});

const installationListQuery = listQuery.keys({
    workflow_phase: Joi.string().valid(...workflowPhases),
    admin_log_response_status: Joi.string().valid(...adminLogResponse),
    related_job_order_id: uuid,
    related_po_id: uuid,
});

// ---------------------------------------------------------------------------
// PM
// ---------------------------------------------------------------------------

const pmWorkflow = ['scheduled', 'in_progress', 'completed'];

const pmCoreOptional = {
    related_po_id: uuid.allow(null),
    assigned_engineer_id: uuid.allow(null),
    pm_schedule_date: Joi.date().iso().allow(null),
    pm_start_date: Joi.date().iso().allow(null),
    pm_end_date: Joi.date().iso().allow(null),
    work_duration_start: Joi.date().iso().allow(null),
    work_duration_end: Joi.date().iso().allow(null),
    pm_activity_notes: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...pmWorkflow),
    service_report_file_ids: fileIds,
    bastp_file_ids: fileIds,
};

const pmCreate = Joi.object({
    related_job_order_id: uuid.required(),
    ...pmCoreOptional,
});

const pmUpdate = Joi.object(pmCoreOptional).min(1);

const pmListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...pmWorkflow),
    related_job_order_id: uuid,
});

// ---------------------------------------------------------------------------
// SPAREPART
// ---------------------------------------------------------------------------

const sparepartWorkflow = ['awaiting_awb', 'workshop_check', 'ready', 'dispatched'];

const sparepartCoreOptional = {
    related_po_id: uuid.allow(null),
    related_awb_id: uuid.allow(null),
    workshop_check_status: Joi.string().valid('Pending', 'In Progress', 'Passed', 'Failed'),
    ready_to_deliver: yesNo.allow(null),
    delivery_method: Joi.string().valid(...deliveryMethods).allow(null),
    admin_log_response_status: Joi.string().valid(...adminLogResponse),
    ready_to_deliver_at: Joi.date().iso().allow(null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...sparepartWorkflow),
    billing_support_file_ids: fileIds,
};

const sparepartCreate = Joi.object({
    related_job_order_id: uuid.required(),
    ...sparepartCoreOptional,
});

const sparepartUpdate = Joi.object(sparepartCoreOptional).min(1);

const sparepartListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...sparepartWorkflow),
    admin_log_response_status: Joi.string().valid(...adminLogResponse),
    related_job_order_id: uuid,
});

// ---------------------------------------------------------------------------
// INSPECTION & QC
// ---------------------------------------------------------------------------

const itemConditions = ['Good', 'Incomplete', 'Damaged'];
const defectCategories = ['None', 'Physical', 'Functional', 'Documentation'];
const qcResults = ['Pass', 'Need Fix', 'Reject'];
const reviewStatuses = ['Pending Review', 'Reviewed', 'Approved'];
const finalSubmitStatuses = ['Draft', 'Submitted'];

const qcCoreOptional = {
    related_job_order_id: uuid.allow(null),
    related_po_id: uuid.allow(null),
    item_or_equipment_name: Joi.string().max(500).allow('', null),
    item_condition: Joi.string().valid(...itemConditions).allow(null),
    defect_category: Joi.string().valid(...defectCategories),
    defect_description: Joi.string().allow('', null),
    pic_user_id: uuid.allow(null),
    qc_result: Joi.string().valid(...qcResults).allow(null),
    review_status: Joi.string().valid(...reviewStatuses),
    final_submit_status: Joi.string().valid(...finalSubmitStatuses),
    notes: Joi.string().allow('', null),
    attachment_qc_file_ids: fileIds,
};

const qcCreate = Joi.object(qcCoreOptional);
const qcUpdate = Joi.object(qcCoreOptional).min(1);

// review/approve transition — callers supply one or both status fields.
const qcSubmitReview = Joi.object({
    review_status: Joi.string().valid(...reviewStatuses),
    final_submit_status: Joi.string().valid(...finalSubmitStatuses),
    note: Joi.string().max(2000).allow('', null),
}).min(1);

const qcListQuery = listQuery.keys({
    review_status: Joi.string().valid(...reviewStatuses),
    final_submit_status: Joi.string().valid(...finalSubmitStatuses),
    qc_result: Joi.string().valid(...qcResults),
    related_po_id: uuid,
});

// ---------------------------------------------------------------------------
// BAST
// ---------------------------------------------------------------------------

const bastWorkflow = ['draft', 'submitted', 'sent_to_finance'];

const bastCoreOptional = {
    related_job_order_id: uuid.allow(null),
    related_po_id: uuid.allow(null),
    customer_id: uuid.allow(null),
    job_type: Joi.string().valid(...jobTypes).allow(null),
    completion_start_date: Joi.date().iso().allow(null),
    completion_end_date: Joi.date().iso().allow(null),
    scope_summary: Joi.string().allow('', null),
    commissioning_included: yesNo.allow(null),
    training_included: yesNo.allow(null),
    customer_pic: Joi.string().max(500).allow('', null),
    technical_pic_id: uuid.allow(null),
    notes: Joi.string().allow('', null),
    workflow_status: Joi.string().valid(...bastWorkflow),
    attachment_bast_file_ids: fileIds,
    attachment_service_report_file_ids: fileIds,
    attachment_test_result_file_ids: fileIds,
};

const bastCreate = Joi.object(bastCoreOptional);
const bastUpdate = Joi.object(bastCoreOptional).min(1);

const bastSendToFinance = Joi.object({
    attachment_ids: fileIds,
    note: Joi.string().max(2000).allow('', null),
});

const bastListQuery = listQuery.keys({
    workflow_status: Joi.string().valid(...bastWorkflow),
    job_type: Joi.string().valid(...jobTypes),
    related_po_id: uuid,
});

module.exports = {
    idParam,

    jobOrderCreate, jobOrderUpdate, jobOrderListQuery,

    installationCreate, installationUpdate, installationListQuery,
    readyToDeliverRequest,

    pmCreate, pmUpdate, pmListQuery,

    sparepartCreate, sparepartUpdate, sparepartListQuery,

    qcCreate, qcUpdate, qcSubmitReview, qcListQuery,

    bastCreate, bastUpdate, bastSendToFinance, bastListQuery,
};

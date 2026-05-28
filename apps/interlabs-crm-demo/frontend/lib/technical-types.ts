/**
 * Technical module entity types.
 *
 * Column names mirror the backend (migration + technical.validators.js) so
 * payloads map 1:1 onto the API. All workflow/status enum values here match
 * the Joi validators in `backend/src/validators/technical.validators.js`.
 *
 * Server-managed fields (record numbers, sent_to_finance timestamps,
 * due_date_reminder_flag, ready_to_deliver_at, admin_log_response_status)
 * are read-only from the client and stripped from create/update payload types.
 */

import type { UUID, ISODate, ISODateTime } from './sales-types';

export type { UUID, ISODate, ISODateTime };

type AuditFields = {
    id: UUID;
    created_by: UUID | null;
    updated_by: UUID | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    deleted_at: ISODateTime | null;
};

// ---------------------------------------------------------------------------
// SHARED ENUMS
// ---------------------------------------------------------------------------

export type JobType = 'Installation' | 'PM' | 'Sparepart';
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
export type YesNo = 'Yes' | 'No';
export type DeliveryMethod = 'Pick Up Forwarder' | 'Hand Carry';
export type AdminLogResponse = 'pending' | 'acknowledged' | 'dispatched';

// ---------------------------------------------------------------------------
// TECHNICAL JOB ORDER
// ---------------------------------------------------------------------------

export type JobOrderWorkflow = 'draft' | 'active' | 'completed' | 'cancelled';

export type TechnicalJobOrder = AuditFields & {
    technical_job_order_number: string;
    related_po_id: UUID | null;
    related_po_number: string | null;
    customer_id: UUID | null;
    job_type: JobType;
    planned_start_date: ISODate | null;
    planned_end_date: ISODate | null;
    work_duration_start: ISODate | null;
    work_duration_end: ISODate | null;
    assigned_engineer_id: UUID | null;
    support_team_members: UUID[];
    site_location: string | null;
    product_or_equipment_name: string | null;
    serial_number: string | null;
    priority: Priority | null;
    current_technical_status: string | null;
    po_due_date: ISODate | null;
    due_date_reminder_flag: boolean;
    notes: string | null;
    workflow_status: JobOrderWorkflow;
};

export type TechnicalJobOrderInput = Omit<
    TechnicalJobOrder,
    keyof AuditFields | 'technical_job_order_number' | 'due_date_reminder_flag'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// INSTALLATION
// ---------------------------------------------------------------------------

export type PreInstallationStatus = 'Pending' | 'In Progress' | 'Complete';
export type WorkshopCheckStatus = 'Pending' | 'In Progress' | 'Passed' | 'Failed';
export type InspectionStatus = 'Pending' | 'In Progress' | 'Complete';
export type DocumentCompletenessStatus = 'Complete' | 'Incomplete';
export type FunctionTestStatus = 'Pending' | 'Pass' | 'Fail';
export type InstallationWorkflowPhase =
    | 'pre_installation' | 'workshop' | 'ready_to_deliver'
    | 'scheduling' | 'on_site' | 'commissioning' | 'completed';

export type InstallationRecord = AuditFields & {
    related_job_order_id: UUID;
    related_po_id: UUID | null;
    pre_installation_status: PreInstallationStatus;
    local_part_request_needed: YesNo | null;
    local_part_request_reference: string | null;
    finance_local_part_status: string | null;
    workshop_check_status: WorkshopCheckStatus;
    inspection_status: InspectionStatus;
    document_completeness_status: DocumentCompletenessStatus | null;
    function_test_status: FunctionTestStatus;
    ready_to_deliver: YesNo | null;
    delivery_method: DeliveryMethod | null;
    admin_log_response_status: AdminLogResponse;
    ready_to_deliver_at: ISODateTime | null;
    installation_schedule_date: ISODate | null;
    installation_start_date: ISODate | null;
    installation_end_date: ISODate | null;
    commissioning_included: YesNo | null;
    training_included: YesNo | null;
    workflow_phase: InstallationWorkflowPhase;
    notes: string | null;
};

export type InstallationCreateInput = Omit<
    InstallationRecord,
    keyof AuditFields | 'admin_log_response_status' | 'ready_to_deliver_at'
> & {
    qc_form_file_ids?: UUID[];
    bast_upload_file_ids?: UUID[];
};

export type InstallationUpdateInput = Partial<
    Omit<InstallationCreateInput, 'related_job_order_id'>
>;

/** Payload for PUT /installations/:id/ready-to-deliver. */
export type ReadyToDeliverInput = {
    delivery_method: DeliveryMethod;
    note?: string | null;
};

// ---------------------------------------------------------------------------
// PM (PREVENTIVE MAINTENANCE)
// ---------------------------------------------------------------------------

export type PmWorkflow = 'scheduled' | 'in_progress' | 'completed';

export type PmRecord = AuditFields & {
    related_job_order_id: UUID;
    related_po_id: UUID | null;
    assigned_engineer_id: UUID | null;
    pm_schedule_date: ISODate | null;
    pm_start_date: ISODate | null;
    pm_end_date: ISODate | null;
    work_duration_start: ISODate | null;
    work_duration_end: ISODate | null;
    pm_activity_notes: string | null;
    notes: string | null;
    workflow_status: PmWorkflow;
};

export type PmCreateInput = Omit<PmRecord, keyof AuditFields> & {
    service_report_file_ids?: UUID[];
    bastp_file_ids?: UUID[];
};

export type PmUpdateInput = Partial<Omit<PmCreateInput, 'related_job_order_id'>>;

// ---------------------------------------------------------------------------
// SPAREPART
// ---------------------------------------------------------------------------

export type SparepartWorkflow =
    | 'awaiting_awb' | 'workshop_check' | 'ready' | 'dispatched';

export type SparepartRecord = AuditFields & {
    related_job_order_id: UUID;
    related_po_id: UUID | null;
    related_awb_id: UUID | null;
    workshop_check_status: WorkshopCheckStatus;
    ready_to_deliver: YesNo | null;
    delivery_method: DeliveryMethod | null;
    admin_log_response_status: AdminLogResponse;
    ready_to_deliver_at: ISODateTime | null;
    notes: string | null;
    workflow_status: SparepartWorkflow;
};

export type SparepartCreateInput = Omit<
    SparepartRecord,
    keyof AuditFields | 'admin_log_response_status' | 'ready_to_deliver_at'
> & {
    billing_support_file_ids?: UUID[];
};

export type SparepartUpdateInput = Partial<
    Omit<SparepartCreateInput, 'related_job_order_id'>
>;

// ---------------------------------------------------------------------------
// INSPECTION & QC
// ---------------------------------------------------------------------------

export type ItemCondition = 'Good' | 'Incomplete' | 'Damaged';
export type DefectCategory = 'None' | 'Physical' | 'Functional' | 'Documentation';
export type QcResult = 'Pass' | 'Need Fix' | 'Reject';
export type QcReviewStatus = 'Pending Review' | 'Reviewed' | 'Approved';
export type QcFinalSubmitStatus = 'Draft' | 'Submitted';

export type InspectionQcRecord = AuditFields & {
    qc_record_number: string;
    related_job_order_id: UUID | null;
    related_po_id: UUID | null;
    item_or_equipment_name: string | null;
    item_condition: ItemCondition | null;
    defect_category: DefectCategory;
    defect_description: string | null;
    pic_user_id: UUID | null;
    qc_result: QcResult | null;
    review_status: QcReviewStatus;
    final_submit_status: QcFinalSubmitStatus;
    notes: string | null;
};

export type InspectionQcCreateInput = Omit<
    InspectionQcRecord, keyof AuditFields | 'qc_record_number'
> & {
    attachment_qc_file_ids?: UUID[];
};

export type InspectionQcUpdateInput = Partial<InspectionQcCreateInput>;

/** Payload for PUT /inspection-qc/:id/submit-review. */
export type QcSubmitReviewInput = {
    review_status?: QcReviewStatus;
    final_submit_status?: QcFinalSubmitStatus;
    note?: string | null;
};

// ---------------------------------------------------------------------------
// BAST
// ---------------------------------------------------------------------------

export type BastWorkflow = 'draft' | 'submitted' | 'sent_to_finance';

export type BastRecord = AuditFields & {
    bast_record_number: string;
    related_job_order_id: UUID | null;
    related_po_id: UUID | null;
    customer_id: UUID | null;
    job_type: JobType | null;
    completion_start_date: ISODate | null;
    completion_end_date: ISODate | null;
    scope_summary: string | null;
    commissioning_included: YesNo | null;
    training_included: YesNo | null;
    customer_pic: string | null;
    technical_pic_id: UUID | null;
    notes: string | null;
    workflow_status: BastWorkflow;
    sent_to_finance: boolean;
    sent_to_finance_at: ISODateTime | null;
};

export type BastCreateInput = Omit<
    BastRecord,
    keyof AuditFields | 'bast_record_number' | 'sent_to_finance' | 'sent_to_finance_at'
> & {
    attachment_bast_file_ids?: UUID[];
    attachment_service_report_file_ids?: UUID[];
    attachment_test_result_file_ids?: UUID[];
};

export type BastUpdateInput = Partial<BastCreateInput>;

/** Payload for PUT /bast/:id/send-to-finance. */
export type BastSendToFinanceInput = {
    attachment_ids?: UUID[];
    note?: string | null;
};

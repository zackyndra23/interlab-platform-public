/**
 * Admin & Log module entity types.
 *
 * Column names mirror the backend (migrations 006 + backend validators) so
 * payloads map 1:1 to the API. Record-number and SLA-derived columns are
 * read-only on the client — they appear on display surfaces but are
 * stripped from create/update payload types.
 */

import type {
    UUID, ISODate, ISODateTime, Currency, AttachmentMetadata,
} from './sales-types';

export type { UUID, ISODate, ISODateTime, Currency, AttachmentMetadata };

type AuditFields = {
    id: UUID;
    created_by: UUID | null;
    updated_by: UUID | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    deleted_at: ISODateTime | null;
};

// ---------------------------------------------------------------------------
// AIRWAY BILL
// ---------------------------------------------------------------------------

export type ShipmentMethod = 'Air' | 'Sea' | 'Land' | 'Courier';
export type AwbStatus = 'Registered' | 'Processed' | 'Arrived';

export type AwbRecord = AuditFields & {
    awb_record_number: string;
    related_po_id: UUID;
    related_po_number: string | null;
    customer_id: UUID | null;
    supplier_or_manufacturer: string | null;
    forwarder_or_courier: string | null;
    awb_tracking_number: string | null;
    shipment_method: ShipmentMethod | null;
    origin_country: string | null;
    transit_country_or_hub: string | null;
    destination: string | null;
    despatch_date: ISODate | null;
    transit_date: ISODate | null;
    arrival_date: ISODate | null;
    current_awb_status: AwbStatus;
    weight_kg: number | null;
    package_count: number | null;
    description_of_goods: string | null;
    incoterm: string | null;
    notes: string | null;
    /** Hydrated by GET /awb/:id; absent on list endpoints. */
    attachments?: AttachmentMetadata[];
};

export type AwbInput = Omit<
    AwbRecord,
    keyof AuditFields | 'awb_record_number' | 'current_awb_status'
> & {
    attachment_ids?: UUID[];
};

export type AwbStatusHistoryEntry = {
    id: UUID;
    awb_id: UUID;
    status_code: string;
    updated_by_user_id: UUID | null;
    updated_by_role: string | null;
    note: string | null;
    attachment_url: string | null;
    created_at: ISODateTime;
};

// ---------------------------------------------------------------------------
// DELIVERY ORDER
// ---------------------------------------------------------------------------

export type DoStatus = 'Registered' | 'Arrived';

export type DoItem = {
    item_name: string;
    description?: string | null;
    qty?: number | null;
    unit?: string | null;
};

export type DeliveryOrder = AuditFields & {
    do_record_number: string;
    related_po_id: UUID;
    related_po_number: string | null;
    customer_id: UUID | null;
    delivery_order_number: string | null;
    delivery_date: ISODate | null;
    shipping_method: string | null;
    courier_or_expedition_vendor: string | null;
    dispatch_from: string | null;
    delivery_address: string | null;
    invoicing_address: string | null;
    item_list: DoItem[];
    technical_inspection_reference_date: ISODate | null;
    customer_arrival_date: ISODate | null;
    current_do_status: DoStatus;
    remarks: string | null;
};

export type DeliveryOrderInput = Omit<
    DeliveryOrder,
    keyof AuditFields | 'do_record_number' | 'current_do_status'
> & {
    attachment_ids?: UUID[];
};

export type DoStatusHistoryEntry = {
    id: UUID;
    do_id: UUID;
    status_code: string;
    updated_by_user_id: UUID | null;
    updated_by_role: string | null;
    note: string | null;
    attachment_url: string | null;
    created_at: ISODateTime;
};

// ---------------------------------------------------------------------------
// OPERATIONAL (petty cash)
// ---------------------------------------------------------------------------

export type PaymentMethod = 'Cash' | 'Transfer' | 'Credit Card';
export type ExpenseStatus = 'Pending' | 'Paid' | 'Cancelled';
export type OperationalWorkflow = 'draft' | 'submitted' | 'reviewed';

export type OperationalRecord = AuditFields & {
    operational_record_number: string;
    reporting_month: ISODate | null;
    department: string | null;
    expense_category: string | null;
    expense_subcategory: string | null;
    transaction_date: ISODate | null;
    period_start: ISODate | null;
    period_end: ISODate | null;
    vendor_or_payee: string | null;
    related_po_id: UUID | null;
    description: string | null;
    currency: Currency;
    amount: number | null;
    payment_method: PaymentMethod | null;
    expense_status: ExpenseStatus;
    notes: string | null;
    workflow_status: OperationalWorkflow;
};

export type OperationalInput = Omit<
    OperationalRecord,
    keyof AuditFields | 'operational_record_number' | 'workflow_status'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// READY-TO-DELIVER (Technical handoff)
// ---------------------------------------------------------------------------

export type ReadyToDeliverStatus = 'pending' | 'acknowledged' | 'dispatched';

export type ReadyToDeliverEntry = {
    id: UUID;
    related_po_id: UUID | null;
    related_po_number: string | null;
    related_job_order_id: UUID | null;
    technical_job_order_number: string | null;
    customer_id: UUID | null;
    customer_name: string | null;
    delivery_method: 'Pick Up Forwarder' | 'Hand Carry' | null;
    admin_log_response_status: ReadyToDeliverStatus;
    ready_to_deliver_at: ISODateTime | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
};

export type ReadyToDeliverAckInput = {
    response_status: 'acknowledged' | 'dispatched';
    delivery_method?: 'Pick Up Forwarder' | 'Hand Carry' | null;
    note?: string | null;
};

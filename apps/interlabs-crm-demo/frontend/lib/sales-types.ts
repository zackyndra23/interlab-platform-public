/**
 * Sales module entity types. Mirror the backend column names exactly so
 * form payloads go straight to the API without adapter layers.
 *
 * Each entity only declares the fields the frontend actually reads or
 * writes — audit columns (created_at/updated_at/deleted_at) appear where
 * pages display them and are omitted from create/update request types.
 */

export type UUID = string;
export type ISODate = string;         // 'YYYY-MM-DD'
export type ISODateTime = string;     // full RFC3339

export type Currency = 'IDR' | 'USD' | 'EUR';

export type SlaStepStatus = 'on_track' | 'overdue';

// Hydrated file_attachments row returned on detail endpoints. Structurally
// compatible with shared/MultiFileUpload's `UploadedFile` so AttachmentList
// can consume it directly.
export type AttachmentMetadata = {
    id: UUID;
    original_filename: string;
    mime_type: string | null;
    extension?: string | null;
    size_bytes?: number | null;
    uploaded_at?: ISODateTime;
    created_at?: ISODateTime;
};

type AuditFields = {
    id: UUID;
    created_by: UUID | null;
    updated_by: UUID | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    deleted_at: ISODateTime | null;
};

// ---------------------------------------------------------------------------
// CUSTOMER
// ---------------------------------------------------------------------------

export type CustomerStatus = 'Active' | 'Inactive';

export type Customer = AuditFields & {
    customer_record_number: string;
    company_name: string;
    trade_name: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    npwp: string | null;
    pic_name: string | null;
    pic_phone: string | null;
    pic_email: string | null;
    customer_status: CustomerStatus;
    notes: string | null;
};

export type CustomerInput = Omit<
    Customer,
    keyof AuditFields | 'customer_record_number'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// SALES FORECAST
// ---------------------------------------------------------------------------

export type ForecastStage =
    | 'Prospect' | 'Qualified' | 'Proposal' | 'Negotiation' | 'Won' | 'Lost';

export type ForecastWorkflow = 'draft' | 'submitted' | 'closed';

export type SalesForecast = AuditFields & {
    forecast_record_number: string;
    customer_id: UUID | null;
    product_or_service_name: string;
    description: string | null;
    forecast_period_start: ISODate | null;
    forecast_period_end: ISODate | null;
    currency: Currency;
    estimated_value: number | null;
    probability_percent: number | null;
    stage: ForecastStage;
    expected_close_date: ISODate | null;
    pic_user_id: UUID | null;
    notes: string | null;
    workflow_status: ForecastWorkflow;
    current_step: string | null;
    step_due_at: ISODateTime | null;
    step_status: SlaStepStatus;
    last_progress_at: ISODateTime | null;
};

export type SalesForecastInput = Omit<
    SalesForecast,
    keyof AuditFields | 'forecast_record_number'
        | 'step_due_at' | 'step_status' | 'last_progress_at' | 'current_step'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// QUOTATION
// ---------------------------------------------------------------------------

export type QuotationWorkflow =
    | 'draft' | 'submitted' | 'revised' | 'accepted' | 'rejected';

export type QuotationItem = {
    item_name: string;
    description?: string | null;
    qty: number;
    unit: string;
    unit_price: number;
    total_price: number;
};

export type Quotation = AuditFields & {
    quotation_record_number: string;
    quotation_number: string | null;
    customer_id: UUID | null;
    related_forecast_id: UUID | null;
    quotation_date: ISODate | null;
    validity_date: ISODate | null;
    currency: Currency;
    item_list: QuotationItem[];
    subtotal: number | null;
    discount_percent: number | null;
    discount_amount: number | null;
    tax_percent: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    payment_terms: string | null;
    delivery_terms: string | null;
    warranty_terms: string | null;
    notes: string | null;
    workflow_status: QuotationWorkflow;
    step_status: SlaStepStatus;
    step_due_at: ISODateTime | null;
};

export type QuotationInput = Omit<
    Quotation,
    keyof AuditFields | 'quotation_record_number' | 'step_due_at' | 'step_status'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// HARGA POKOK PENJUALAN (HPP)
// ---------------------------------------------------------------------------

export type HppWorkflow = 'draft' | 'submitted' | 'approved';

export type HppItem = {
    item_name: string;
    qty: number;
    unit: string;
    cost_price: number;
    selling_price: number;
    margin_amount: number;
    margin_percent: number;
};

export type HargaPokokPenjualan = AuditFields & {
    hpp_record_number: string;
    customer_id: UUID | null;
    related_quotation_id: UUID | null;
    hpp_date: ISODate | null;
    currency: Currency;
    item_list: HppItem[];
    total_cost: number | null;
    total_selling_price: number | null;
    gross_margin_total: number | null;
    notes: string | null;
    workflow_status: HppWorkflow;
    step_status: SlaStepStatus;
    step_due_at: ISODateTime | null;
};

export type HargaPokokPenjualanInput = Omit<
    HargaPokokPenjualan,
    keyof AuditFields | 'hpp_record_number' | 'step_due_at' | 'step_status'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// SALES PURCHASE ORDER
// ---------------------------------------------------------------------------

export type SalesPoWorkflow = 'draft' | 'submitted' | 'processed' | 'overdue';

export type PoItem = {
    item_name: string;
    description?: string | null;
    qty: number;
    unit: string;
    unit_price: number;
    total_price: number;
};

export type SalesPurchaseOrder = AuditFields & {
    po_record_number: string;
    po_number: string | null;
    customer_id: UUID | null;
    related_quotation_id: UUID | null;
    order_date: ISODate | null;
    delivery_deadline: ISODate | null;
    currency: Currency;
    payment_terms: string | null;
    delivery_terms: string | null;
    item_list: PoItem[];
    subtotal: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    notes: string | null;
    po_id: UUID | null;
    workflow_status: SalesPoWorkflow;
    step_status: SlaStepStatus;
    step_due_at: ISODateTime | null;
    overdue_reason: string | null;
    overdue_attachment_id: UUID | null;
    /** Hydrated by GET /purchase-orders/:id; absent on list endpoints. */
    attachments?: AttachmentMetadata[];
};

export type SalesPurchaseOrderInput = Omit<
    SalesPurchaseOrder,
    keyof AuditFields | 'po_record_number' | 'po_id'
        | 'step_due_at' | 'step_status'
        | 'overdue_reason' | 'overdue_attachment_id'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// PURCHASE REQUEST
// ---------------------------------------------------------------------------

export type PurchaseRequestWorkflow = 'draft' | 'submitted' | 'copied_to_finance';

export type Incoterm =
    | 'EXW' | 'FOB' | 'CIF' | 'DDP' | 'DAP' | 'CPT' | 'FCA';

export type PurchaseRequestSales = AuditFields & {
    pr_record_number: string;
    related_po_id: UUID | null;
    customer_id: UUID | null;
    supplier_or_manufacturer: string | null;
    manufacturer_contact: string | null;
    manufacturer_email: string | null;
    pr_date: ISODate | null;
    currency: Currency;
    item_list: PoItem[];
    incoterm: Incoterm | null;
    delivery_time: string | null;
    payment_terms: string | null;
    shipping_address: string | null;
    notes: string | null;
    workflow_status: PurchaseRequestWorkflow;
    step_status: SlaStepStatus;
    step_due_at: ISODateTime | null;
};

export type PurchaseRequestSalesInput = Omit<
    PurchaseRequestSales,
    keyof AuditFields | 'pr_record_number' | 'step_due_at' | 'step_status'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// WORKFLOW HISTORY (generic, shared across Sales modules)
// ---------------------------------------------------------------------------

export type WorkflowStepEntry = {
    id: UUID;
    entity_type: string;
    entity_id: UUID;
    step_name: string;
    step_status: string;
    actor_user_id: UUID | null;
    actor_role: string | null;
    note: string | null;
    created_at: ISODateTime;
};

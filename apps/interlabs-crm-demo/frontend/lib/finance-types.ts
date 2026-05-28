/**
 * Finance module entity types.
 *
 * Column names mirror the backend (migration 007 + backend validators) so
 * payloads map 1:1 onto the API. `workflow_status` / `payment_status` /
 * `invoice_status` / `current_pr_status` are server-managed and treated
 * as read-only on the client (stripped from create/update payload types).
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

// Item list shape shared across all Finance forms. Backend validator
// `itemListEntry` accepts `unit_price`, `subtotal_per_item`, and
// `total_price` — the frontend uses `total_price` (matching Sales) and
// the backend ignores unused keys via `unknown(true)`.
export type FinanceItem = {
    item_name: string;
    description?: string | null;
    qty: number;
    unit: string;
    unit_price: number;
    total_price: number;
};

// ---------------------------------------------------------------------------
// PO CUSTOMER
// ---------------------------------------------------------------------------

export type PoCustomerWorkflow =
    | 'registered' | 'active' | 'invoiced' | 'completed';

export type PoCustomer = AuditFields & {
    po_customer_record_number: string;
    po_customer_number: string | null;
    related_sales_po_id: UUID | null;
    related_po_id: UUID | null;
    customer_id: UUID | null;
    version: string | null;
    order_date: ISODate | null;
    quotation_reference_id: UUID | null;
    payment_term_condition: string | null;
    delivery_term: string | null;
    term_of_payment: string | null;
    warranty: string | null;
    penalty_clause: string | null;
    bill_to: string | null;
    ship_to: string | null;
    currency: Currency;
    item_list: FinanceItem[];
    subtotal: number | null;
    tax_percent: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    notes: string | null;
    current_po_status: string | null;   // mirrors purchase_orders.current_status
    workflow_status: PoCustomerWorkflow;
};

/** PO Customer has no create endpoint — only update. */
export type PoCustomerInput = Omit<
    PoCustomer,
    keyof AuditFields | 'po_customer_record_number'
        | 'related_sales_po_id' | 'related_po_id'
        | 'current_po_status' | 'workflow_status'
> & {
    attachment_ids?: UUID[];
};

// ---------------------------------------------------------------------------
// PURCHASE REQUISITION
// ---------------------------------------------------------------------------

export type PrStatus = 'Registered' | 'Processed';

export type PurchaseRequisition = AuditFields & {
    pr_record_number: string;
    related_sales_pr_id: UUID | null;
    related_po_id: UUID | null;
    related_po_customer_id: UUID | null;
    customer_id: UUID | null;
    supplier_or_manufacturer: string | null;
    manufacturer_contact_person: string | null;
    manufacturer_email: string | null;
    pr_number: string | null;
    pr_date: ISODate | null;
    currency: Currency;
    item_list: FinanceItem[];
    incoterm: string | null;
    delivery_time: string | null;
    payment_term: string | null;
    shipping_address: string | null;
    notes: string | null;
    po_out_number: string | null;
    po_out_date: ISODate | null;
    current_pr_status: PrStatus;
};

/** PR has no create endpoint — only update. */
export type PurchaseRequisitionInput = Omit<
    PurchaseRequisition,
    keyof AuditFields | 'pr_record_number'
        | 'related_sales_pr_id' | 'related_po_id'
        | 'current_pr_status'
        | 'po_out_number' | 'po_out_date'   // managed by /upload-po-out
> & {
    attachment_ids?: UUID[];
};

/** Payload for POST /purchase-requisitions/:id/upload-po-out. */
export type UploadPoOutInput = {
    po_out_number: string;
    po_out_date: ISODate;
    attachment_ids: UUID[];
    note?: string | null;
};

// ---------------------------------------------------------------------------
// INVOICE MANUFACTURE
// ---------------------------------------------------------------------------

export type InvoiceManufacturePaymentStatus = 'Unpaid' | 'Paid';

export type InvoiceManufacture = AuditFields & {
    invoice_manufacture_record_number: string;
    related_pr_id: UUID | null;
    related_po_out_number: string | null;
    related_po_id: UUID | null;
    supplier_or_manufacturer: string | null;
    invoice_number: string | null;
    invoice_date: ISODate | null;
    due_date: ISODate | null;
    payment_terms: string | null;
    preferred_shipping: string | null;
    incoterm: string | null;
    currency: Currency;
    exchange_rate: number | null;
    item_list: FinanceItem[];
    untaxed_amount: number | null;
    vat_percent: number | null;
    vat_amount: number | null;
    total_amount: number | null;
    bank_name: string | null;
    iban_or_account_number: string | null;
    bic_swift: string | null;
    payment_date: ISODate | null;
    payment_amount: number | null;
    payment_status: InvoiceManufacturePaymentStatus;
    transaction_reference: string | null;
    notes: string | null;
    /** Hydrated by GET /invoice-manufactures/:id; absent on list endpoints. */
    attachments?: AttachmentMetadata[];
};

export type InvoiceManufactureInput = Omit<
    InvoiceManufacture,
    keyof AuditFields | 'invoice_manufacture_record_number'
        | 'payment_status' | 'payment_date' | 'payment_amount'
> & {
    attachment_ids?: UUID[];
};

/** Payload for PUT /invoice-manufactures/:id/upload-payment. */
export type UploadPaymentInput = {
    payment_date: ISODate;
    payment_amount: number;
    transaction_reference?: string | null;
    attachment_ids: UUID[];
    note?: string | null;
};

// ---------------------------------------------------------------------------
// INVOICE CUSTOMER
// ---------------------------------------------------------------------------

export type InvoiceCustomerStatus = 'Registered' | 'Processed';

export type InvoiceCustomer = AuditFields & {
    invoice_customer_record_number: string;
    related_po_customer_id: UUID | null;
    related_bast_id: UUID | null;
    related_do_id: UUID | null;
    related_po_id: UUID | null;
    customer_id: UUID | null;
    invoice_number: string | null;
    invoice_date: ISODate | null;
    customer_order_number: string | null;
    order_date: ISODate | null;
    currency: Currency;
    shipping_method: string | null;
    item_list: FinanceItem[];
    subtotal: number | null;
    discount_amount: number | null;
    tax_base: number | null;
    vat_percent: number | null;
    vat_amount: number | null;
    total_amount: number | null;
    billing_account_info: string | null;
    payment_due_date: ISODate | null;
    invoice_status: InvoiceCustomerStatus;
    notes: string | null;
};

export type InvoiceCustomerInput = Omit<
    InvoiceCustomer,
    keyof AuditFields | 'invoice_customer_record_number'
        | 'invoice_status' | 'invoice_number'   // invoice_number gated by /upload-invoice
> & {
    attachment_ids?: UUID[];
};

/** Payload for PUT /invoice-customers/:id/upload-invoice. */
export type UploadInvoiceInput = {
    invoice_number: string;
    invoice_date?: ISODate | null;
    attachment_ids: UUID[];
    note?: string | null;
};

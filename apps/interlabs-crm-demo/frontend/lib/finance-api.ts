import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    InvoiceCustomer, InvoiceCustomerInput,
    InvoiceManufacture, InvoiceManufactureInput,
    PoCustomer, PoCustomerInput,
    PurchaseRequisition, PurchaseRequisitionInput,
    UploadInvoiceInput, UploadPaymentInput, UploadPoOutInput,
    UUID,
} from './finance-types';

/**
 * Typed wrappers around the /api/finance/* endpoints.
 *
 * Endpoint shape (see backend/src/routes/finance.routes.js):
 *   /po-customers             (list / get / update / delete — no create)
 *   /purchase-requisitions    (list / get / update / delete + /:id/upload-po-out)
 *   /invoice-manufactures     (full CRUD + /:id/upload-payment)
 *   /invoice-customers        (list / get / update / delete + /:id/upload-invoice)
 *
 * PO Customer + Purchase Requisition + Invoice Customer rows are
 * auto-created by upstream flows (Sales PO submit, Sales PR submit,
 * Technical BAST upload respectively); there is no `.create()` here.
 */

const BASE = '/api/finance';

// ---------- PO CUSTOMER ----------
export const poCustomersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<PoCustomer>(`${BASE}/po-customers`, params),
    get: (id: UUID) => apiGet<PoCustomer>(`${BASE}/po-customers/${id}`),
    update: (id: UUID, input: Partial<PoCustomerInput>) =>
        apiPut<PoCustomer>(`${BASE}/po-customers/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/po-customers/${id}`),
};

// ---------- PURCHASE REQUISITIONS ----------
export const purchaseRequisitionsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<PurchaseRequisition>(`${BASE}/purchase-requisitions`, params),
    get: (id: UUID) =>
        apiGet<PurchaseRequisition>(`${BASE}/purchase-requisitions/${id}`),
    update: (id: UUID, input: Partial<PurchaseRequisitionInput>) =>
        apiPut<PurchaseRequisition>(`${BASE}/purchase-requisitions/${id}`, input),
    /** Advances PR → Processed + master PO → Production. */
    uploadPoOut: (id: UUID, input: UploadPoOutInput) =>
        apiPut<PurchaseRequisition>(
            `${BASE}/purchase-requisitions/${id}/upload-po-out`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/purchase-requisitions/${id}`),
};

// ---------- INVOICE MANUFACTURE ----------
export const invoiceManufacturesApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<InvoiceManufacture>(`${BASE}/invoice-manufactures`, params),
    get: (id: UUID) =>
        apiGet<InvoiceManufacture>(`${BASE}/invoice-manufactures/${id}`),
    create: (input: InvoiceManufactureInput) =>
        apiPost<InvoiceManufacture>(`${BASE}/invoice-manufactures`, input),
    update: (id: UUID, input: Partial<InvoiceManufactureInput>) =>
        apiPut<InvoiceManufacture>(`${BASE}/invoice-manufactures/${id}`, input),
    /** Records payment → sets payment_status=Paid. */
    uploadPayment: (id: UUID, input: UploadPaymentInput) =>
        apiPut<InvoiceManufacture>(
            `${BASE}/invoice-manufactures/${id}/upload-payment`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/invoice-manufactures/${id}`),
};

// ---------- INVOICE CUSTOMER ----------
export const invoiceCustomersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<InvoiceCustomer>(`${BASE}/invoice-customers`, params),
    get: (id: UUID) =>
        apiGet<InvoiceCustomer>(`${BASE}/invoice-customers/${id}`),
    update: (id: UUID, input: Partial<InvoiceCustomerInput>) =>
        apiPut<InvoiceCustomer>(`${BASE}/invoice-customers/${id}`, input),
    /** Finance-side invoice issue → Processed + master PO → Invoice. */
    uploadInvoice: (id: UUID, input: UploadInvoiceInput) =>
        apiPut<InvoiceCustomer>(
            `${BASE}/invoice-customers/${id}/upload-invoice`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/invoice-customers/${id}`),
};

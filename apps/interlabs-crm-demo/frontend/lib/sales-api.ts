import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    Customer, CustomerInput,
    SalesForecast, SalesForecastInput,
    Quotation, QuotationInput,
    HargaPokokPenjualan, HargaPokokPenjualanInput,
    SalesPurchaseOrder, SalesPurchaseOrderInput,
    PurchaseRequestSales, PurchaseRequestSalesInput,
    UUID,
} from './sales-types';

/**
 * Typed wrappers around the /api/sales/* endpoints. Each entity gets a
 * `list / get / create / update / remove` quintet plus any
 * stage-transition verbs (submit, process, overdue-reason, transition).
 *
 * The path segments mirror `backend/src/routes/sales.routes.js`:
 *   - /customers
 *   - /forecasts          (+ /:id/submit)
 *   - /quotations         (+ /:id/transition)
 *   - /harga-pokok-penjualan (+ /:id/transition)
 *   - /purchase-orders    (+ /:id/submit, /process, /overdue-reason)
 *   - /purchase-requests  (+ /:id/submit)
 */

const BASE = '/api/sales';

// ---------- CUSTOMERS ----------
export const customersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<Customer>(`${BASE}/customers`, params),
    get: (id: UUID) => apiGet<Customer>(`${BASE}/customers/${id}`),
    create: (input: CustomerInput) =>
        apiPost<Customer>(`${BASE}/customers`, input),
    update: (id: UUID, input: Partial<CustomerInput>) =>
        apiPut<Customer>(`${BASE}/customers/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/customers/${id}`),
};

// ---------- SALES FORECASTS ----------
export const forecastsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<SalesForecast>(`${BASE}/forecasts`, params),
    get: (id: UUID) => apiGet<SalesForecast>(`${BASE}/forecasts/${id}`),
    create: (input: SalesForecastInput) =>
        apiPost<SalesForecast>(`${BASE}/forecasts`, input),
    update: (id: UUID, input: Partial<SalesForecastInput>) =>
        apiPut<SalesForecast>(`${BASE}/forecasts/${id}`, input),
    submit: (id: UUID, note?: string) =>
        apiPost<SalesForecast>(`${BASE}/forecasts/${id}/submit`, { note }),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/forecasts/${id}`),
};

// ---------- QUOTATIONS ----------
export const quotationsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<Quotation>(`${BASE}/quotations`, params),
    get: (id: UUID) => apiGet<Quotation>(`${BASE}/quotations/${id}`),
    create: (input: QuotationInput) =>
        apiPost<Quotation>(`${BASE}/quotations`, input),
    update: (id: UUID, input: Partial<QuotationInput>) =>
        apiPut<Quotation>(`${BASE}/quotations/${id}`, input),
    transition: (id: UUID, workflow_status: Quotation['workflow_status'], note?: string) =>
        apiPost<Quotation>(`${BASE}/quotations/${id}/transition`, {
            workflow_status, note,
        }),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/quotations/${id}`),
};

// ---------- HARGA POKOK PENJUALAN ----------
export const hppApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<HargaPokokPenjualan>(`${BASE}/harga-pokok-penjualan`, params),
    get: (id: UUID) =>
        apiGet<HargaPokokPenjualan>(`${BASE}/harga-pokok-penjualan/${id}`),
    create: (input: HargaPokokPenjualanInput) =>
        apiPost<HargaPokokPenjualan>(`${BASE}/harga-pokok-penjualan`, input),
    update: (id: UUID, input: Partial<HargaPokokPenjualanInput>) =>
        apiPut<HargaPokokPenjualan>(`${BASE}/harga-pokok-penjualan/${id}`, input),
    transition: (id: UUID, workflow_status: HargaPokokPenjualan['workflow_status'], note?: string) =>
        apiPost<HargaPokokPenjualan>(
            `${BASE}/harga-pokok-penjualan/${id}/transition`,
            { workflow_status, note },
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/harga-pokok-penjualan/${id}`),
};

// ---------- SALES PURCHASE ORDERS ----------
export const salesPoApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<SalesPurchaseOrder>(`${BASE}/purchase-orders`, params),
    get: (id: UUID) =>
        apiGet<SalesPurchaseOrder>(`${BASE}/purchase-orders/${id}`),
    create: (input: SalesPurchaseOrderInput) =>
        apiPost<SalesPurchaseOrder>(`${BASE}/purchase-orders`, input),
    update: (id: UUID, input: Partial<SalesPurchaseOrderInput>) =>
        apiPut<SalesPurchaseOrder>(`${BASE}/purchase-orders/${id}`, input),
    submit: (id: UUID, note?: string) =>
        apiPost<SalesPurchaseOrder>(`${BASE}/purchase-orders/${id}/submit`, { note }),
    process: (id: UUID, note?: string) =>
        apiPost<SalesPurchaseOrder>(`${BASE}/purchase-orders/${id}/process`, { note }),
    overdueReason: (id: UUID, input: { overdue_reason: string; overdue_attachment_id?: UUID }) =>
        apiPost<SalesPurchaseOrder>(
            `${BASE}/purchase-orders/${id}/overdue-reason`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/purchase-orders/${id}`),
};

// ---------- PURCHASE REQUESTS ----------
export const purchaseRequestsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<PurchaseRequestSales>(`${BASE}/purchase-requests`, params),
    get: (id: UUID) =>
        apiGet<PurchaseRequestSales>(`${BASE}/purchase-requests/${id}`),
    create: (input: PurchaseRequestSalesInput) =>
        apiPost<PurchaseRequestSales>(`${BASE}/purchase-requests`, input),
    update: (id: UUID, input: Partial<PurchaseRequestSalesInput>) =>
        apiPut<PurchaseRequestSales>(`${BASE}/purchase-requests/${id}`, input),
    submit: (id: UUID, note?: string) =>
        apiPost<PurchaseRequestSales>(
            `${BASE}/purchase-requests/${id}/submit`, { note },
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/purchase-requests/${id}`),
};

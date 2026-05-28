import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    BastCreateInput, BastRecord, BastSendToFinanceInput, BastUpdateInput,
    InspectionQcCreateInput, InspectionQcRecord, InspectionQcUpdateInput,
    InstallationCreateInput, InstallationRecord, InstallationUpdateInput,
    PmCreateInput, PmRecord, PmUpdateInput,
    QcSubmitReviewInput,
    ReadyToDeliverInput,
    SparepartCreateInput, SparepartRecord, SparepartUpdateInput,
    TechnicalJobOrder, TechnicalJobOrderInput,
    UUID,
} from './technical-types';

/**
 * Typed wrappers around the /api/technical/* endpoints.
 *
 * Endpoint shape (see backend/src/routes/technical.routes.js):
 *   /job-orders               (full CRUD)
 *   /installations            (full CRUD + /:id/ready-to-deliver)
 *   /pm                       (full CRUD)
 *   /spareparts               (full CRUD)
 *   /inspection-qc            (full CRUD + /:id/submit-review)
 *   /bast                     (full CRUD + /:id/send-to-finance)
 */

const BASE = '/api/technical';

// ---------- TECHNICAL JOB ORDER ----------
export const jobOrdersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<TechnicalJobOrder>(`${BASE}/job-orders`, params),
    get: (id: UUID) => apiGet<TechnicalJobOrder>(`${BASE}/job-orders/${id}`),
    create: (input: TechnicalJobOrderInput) =>
        apiPost<TechnicalJobOrder>(`${BASE}/job-orders`, input),
    update: (id: UUID, input: Partial<TechnicalJobOrderInput>) =>
        apiPut<TechnicalJobOrder>(`${BASE}/job-orders/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/job-orders/${id}`),
};

// ---------- INSTALLATION ----------
export const installationsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<InstallationRecord>(`${BASE}/installations`, params),
    get: (id: UUID) => apiGet<InstallationRecord>(`${BASE}/installations/${id}`),
    create: (input: InstallationCreateInput) =>
        apiPost<InstallationRecord>(`${BASE}/installations`, input),
    update: (id: UUID, input: InstallationUpdateInput) =>
        apiPut<InstallationRecord>(`${BASE}/installations/${id}`, input),
    /** Marks ready_to_deliver=Yes + delivery_method + starts Admin&Log 2-day SLA. */
    markReadyToDeliver: (id: UUID, input: ReadyToDeliverInput) =>
        apiPut<InstallationRecord>(`${BASE}/installations/${id}/ready-to-deliver`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/installations/${id}`),
};

// ---------- PM ----------
export const pmApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<PmRecord>(`${BASE}/pm`, params),
    get: (id: UUID) => apiGet<PmRecord>(`${BASE}/pm/${id}`),
    create: (input: PmCreateInput) =>
        apiPost<PmRecord>(`${BASE}/pm`, input),
    update: (id: UUID, input: PmUpdateInput) =>
        apiPut<PmRecord>(`${BASE}/pm/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/pm/${id}`),
};

// ---------- SPAREPART ----------
export const sparepartsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<SparepartRecord>(`${BASE}/spareparts`, params),
    get: (id: UUID) => apiGet<SparepartRecord>(`${BASE}/spareparts/${id}`),
    create: (input: SparepartCreateInput) =>
        apiPost<SparepartRecord>(`${BASE}/spareparts`, input),
    update: (id: UUID, input: SparepartUpdateInput) =>
        apiPut<SparepartRecord>(`${BASE}/spareparts/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/spareparts/${id}`),
};

// ---------- INSPECTION & QC ----------
export const inspectionQcApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<InspectionQcRecord>(`${BASE}/inspection-qc`, params),
    get: (id: UUID) => apiGet<InspectionQcRecord>(`${BASE}/inspection-qc/${id}`),
    create: (input: InspectionQcCreateInput) =>
        apiPost<InspectionQcRecord>(`${BASE}/inspection-qc`, input),
    update: (id: UUID, input: InspectionQcUpdateInput) =>
        apiPut<InspectionQcRecord>(`${BASE}/inspection-qc/${id}`, input),
    /** Forward-only QC review transition. Approved+Submitted → PO Inspected. */
    submitReview: (id: UUID, input: QcSubmitReviewInput) =>
        apiPut<{ inspection_qc: InspectionQcRecord; purchase_order: unknown }>(
            `${BASE}/inspection-qc/${id}/submit-review`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/inspection-qc/${id}`),
};

// ---------- BAST ----------
export const bastApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<BastRecord>(`${BASE}/bast`, params),
    get: (id: UUID) => apiGet<BastRecord>(`${BASE}/bast/${id}`),
    create: (input: BastCreateInput) =>
        apiPost<BastRecord>(`${BASE}/bast`, input),
    update: (id: UUID, input: BastUpdateInput) =>
        apiPut<BastRecord>(`${BASE}/bast/${id}`, input),
    /** Handoff to Finance: auto-creates Invoice Customer draft + PO → BAST. */
    sendToFinance: (id: UUID, input: BastSendToFinanceInput) =>
        apiPut<{ bast: BastRecord; invoiceDraft: unknown; masterPo: unknown }>(
            `${BASE}/bast/${id}/send-to-finance`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/bast/${id}`),
};

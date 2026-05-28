import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    AwbInput, AwbRecord, AwbStatusHistoryEntry,
    DeliveryOrder, DeliveryOrderInput, DoStatusHistoryEntry,
    OperationalInput, OperationalRecord, OperationalWorkflow,
    ReadyToDeliverAckInput, ReadyToDeliverEntry,
    UUID,
} from './admin-log-types';

/**
 * Typed wrappers around the /api/admin-log/* endpoints.
 *
 * Path segments mirror `backend/src/routes/admin_log.routes.js`:
 *   /awb              (+ /:id/history)
 *   /delivery-orders  (+ /:id/history)
 *   /operational      (+ /:id/transition)
 *   /ready-to-deliver (+ /:id/acknowledge)
 */

const BASE = '/api/admin-log';

// ---------- AWB ----------
export const awbApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<AwbRecord>(`${BASE}/awb`, params),
    get: (id: UUID) => apiGet<AwbRecord>(`${BASE}/awb/${id}`),
    history: (id: UUID) =>
        apiGet<AwbStatusHistoryEntry[]>(`${BASE}/awb/${id}/history`),
    create: (input: AwbInput) =>
        apiPost<AwbRecord>(`${BASE}/awb`, input),
    update: (id: UUID, input: Partial<AwbInput>) =>
        apiPut<AwbRecord>(`${BASE}/awb/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/awb/${id}`),
};

// ---------- DELIVERY ORDERS ----------
export const deliveryOrdersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<DeliveryOrder>(`${BASE}/delivery-orders`, params),
    get: (id: UUID) => apiGet<DeliveryOrder>(`${BASE}/delivery-orders/${id}`),
    history: (id: UUID) =>
        apiGet<DoStatusHistoryEntry[]>(`${BASE}/delivery-orders/${id}/history`),
    create: (input: DeliveryOrderInput) =>
        apiPost<DeliveryOrder>(`${BASE}/delivery-orders`, input),
    update: (id: UUID, input: Partial<DeliveryOrderInput>) =>
        apiPut<DeliveryOrder>(`${BASE}/delivery-orders/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/delivery-orders/${id}`),
};

// ---------- OPERATIONAL ----------
export const operationalApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<OperationalRecord>(`${BASE}/operational`, params),
    get: (id: UUID) => apiGet<OperationalRecord>(`${BASE}/operational/${id}`),
    create: (input: OperationalInput) =>
        apiPost<OperationalRecord>(`${BASE}/operational`, input),
    update: (id: UUID, input: Partial<OperationalInput>) =>
        apiPut<OperationalRecord>(`${BASE}/operational/${id}`, input),
    transition: (id: UUID, workflow_status: OperationalWorkflow) =>
        apiPost<OperationalRecord>(`${BASE}/operational/${id}/transition`, {
            workflow_status,
        }),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/operational/${id}`),
};

// ---------- READY-TO-DELIVER ----------
export const readyToDeliverApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<ReadyToDeliverEntry>(`${BASE}/ready-to-deliver`, params),
    acknowledge: (id: UUID, input: ReadyToDeliverAckInput) =>
        apiPost<ReadyToDeliverEntry>(
            `${BASE}/ready-to-deliver/${id}/acknowledge`, input,
        ),
};

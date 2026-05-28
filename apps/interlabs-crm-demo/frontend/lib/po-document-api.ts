import { api } from './api';
import type { PoDocumentType, PoStageHistoryRow, POStage } from './po-document-types';

export const poDocApi = {
  listTypes: () =>
    api.get<{ data: { items: PoDocumentType[] } }>('/api/admin/po-document-types').then(r => r.data.data.items),
  createType: (body: Partial<PoDocumentType>) =>
    api.post<{ data: PoDocumentType }>('/api/admin/po-document-types', body).then(r => r.data.data),
  updateType: (id: string, patch: Partial<PoDocumentType>) =>
    api.patch<{ data: PoDocumentType }>(`/api/admin/po-document-types/${id}`, patch).then(r => r.data.data),
  deleteType: (id: string) =>
    api.delete(`/api/admin/po-document-types/${id}`).then(r => r.data),

  history: (poId: string) =>
    api.get<{ data: { items: PoStageHistoryRow[] } }>(`/api/po/${poId}/history`).then(r => r.data.data.items),
  reject: (poId: string, body: { toStatus: POStage; reason: string }) =>
    api.post(`/api/po/${poId}/reject`, body).then(r => r.data),
  adminOverride: (poId: string, body: { targetStatus: POStage; reason: string }) =>
    api.post(`/api/po/${poId}/admin-override`, body).then(r => r.data),
};

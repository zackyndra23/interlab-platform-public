import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    DashboardMasaPajak, DashboardMonthlyPoint, DashboardPendingActions,
    DashboardPpnPoint, DashboardRecentActivityRow,
    TaxAuditListQuery, TaxAuditLogRow,
    TaxOperationalCreateInput, TaxOperationalListQuery,
    TaxOperationalRecord, TaxOperationalStatusChangeInput,
    TaxOperationalUpdateInput, TaxType, UUID,
} from './tax-types';

/**
 * Typed wrappers around the /api/tax/* endpoints.
 *
 * Endpoint shape (see backend/src/routes/tax.routes.js):
 *   /dashboard/current-masa-pajak            Current Masa Pajak status board
 *   /dashboard/monthly-summary/:taxType      PPh 21 / PPh 25 monthly summary
 *   /dashboard/ppn-summary                   PPN periodic summary
 *   /dashboard/recent-activity               Last 5 audit log rows
 *   /dashboard/pending-actions               Pending-action backlogs
 *   /operational                             CRUD
 *   /operational/:id/status                  Dedicated status-change route
 *   /operational/:id/audit                   Immutable audit log
 */

const BASE = '/api/tax';

export const taxOperationalApi = {
    list: (params?: TaxOperationalListQuery) =>
        apiList<TaxOperationalRecord>(
            `${BASE}/operational`, params as Record<string, unknown>,
        ),

    get: (id: UUID) =>
        apiGet<TaxOperationalRecord>(`${BASE}/operational/${id}`),

    create: (input: TaxOperationalCreateInput) =>
        apiPost<TaxOperationalRecord>(`${BASE}/operational`, input),

    update: (id: UUID, input: TaxOperationalUpdateInput) =>
        apiPut<TaxOperationalRecord>(`${BASE}/operational/${id}`, input),

    /** Dedicated status-change endpoint — logs action='status_changed'. */
    changeStatus: (id: UUID, input: TaxOperationalStatusChangeInput) =>
        apiPut<TaxOperationalRecord>(`${BASE}/operational/${id}/status`, input),

    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(
            `${BASE}/operational/${id}`,
        ),

    audit: (id: UUID, params?: TaxAuditListQuery) =>
        apiList<TaxAuditLogRow>(
            `${BASE}/operational/${id}/audit`,
            params as Record<string, unknown>,
        ),
};

export const taxDashboardApi = {
    currentMasaPajak: () =>
        apiGet<DashboardMasaPajak>(`${BASE}/dashboard/current-masa-pajak`),

    monthlySummary: (taxType: TaxType, months = 12) =>
        apiGet<DashboardMonthlyPoint[]>(
            `${BASE}/dashboard/monthly-summary/${encodeURIComponent(taxType)}`,
            { months },
        ),

    ppnSummary: (months = 12) =>
        apiGet<DashboardPpnPoint[]>(
            `${BASE}/dashboard/ppn-summary`, { months },
        ),

    recentActivity: () =>
        apiGet<DashboardRecentActivityRow[]>(
            `${BASE}/dashboard/recent-activity`,
        ),

    pendingActions: () =>
        apiGet<DashboardPendingActions>(
            `${BASE}/dashboard/pending-actions`,
        ),
};

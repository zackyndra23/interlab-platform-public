import { api } from './api';
import type { Invitation, CreateInvitationResult, InvitationStatus, ActivateResponse } from './invitation-types';

export const invitationApi = {
    list: (status?: InvitationStatus) =>
        api
            .get<{ success: boolean; data: { items: Invitation[] } }>(
                `/api/admin/invitations${status ? `?status=${status}` : ''}`,
            )
            .then((r) => r.data.data.items),

    create: (body: { email: string; roleKey: string; levelId?: string | null }) =>
        api
            .post<{ success: boolean; data: CreateInvitationResult }>(`/api/admin/invitations`, body)
            .then((r) => r.data.data),

    revoke: (id: string, reason?: string) =>
        api
            .post(`/api/admin/invitations/${id}/revoke`, { reason: reason ?? null })
            .then((r) => r.data),

    resend: (id: string) =>
        api
            .post<{ success: boolean; data: CreateInvitationResult }>(
                `/api/admin/invitations/${id}/resend`,
                {},
            )
            .then((r) => r.data.data),

    activate: (body: { token: string; newPassword: string; displayName: string }) =>
        api
            .post<{ success: boolean; data: ActivateResponse }>(`/api/auth/activate`, body)
            .then((r) => r.data.data),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
        api
            .post<{ success: boolean; data: { ok: boolean } }>(`/api/auth/change-password`, body)
            .then((r) => r.data.data),
};

import { api } from './api';
import type {
    RoleLevel, FeatureDef, CapabilityDef, RolePermissionRow,
    UserOverride, CrossDeptGrant,
} from './admin-permissions-types';

export const adminRbacApi = {
    // Levels
    listLevels: (roleKey: string) =>
        api.get<{ success: boolean; data: { items: RoleLevel[] } }>(`/api/admin/roles/${roleKey}/levels`).then(r => r.data.data.items),
    createLevel: (roleKey: string, body: Partial<RoleLevel>) =>
        api.post(`/api/admin/roles/${roleKey}/levels`, body).then(r => r.data),
    updateLevel: (id: string, patch: Partial<RoleLevel>) =>
        api.patch(`/api/admin/levels/${id}`, patch).then(r => r.data),
    deleteLevel: (id: string) =>
        api.delete(`/api/admin/levels/${id}`).then(r => r.data),

    // Matrix — these routes use raw res.json({ items: ... }) (no success wrapper)
    listFeatures: () =>
        api.get<{ items: FeatureDef[] }>(`/api/admin/features`).then(r => r.data.items),
    listCapabilities: () =>
        api.get<{ items: CapabilityDef[] }>(`/api/admin/capabilities`).then(r => r.data.items),
    matrix: () =>
        api.get<{ items: RolePermissionRow[] }>(`/api/admin/role-permissions`).then(r => r.data.items),
    toggleCell: (body: RolePermissionRow & { enabled: boolean }) =>
        api.post(`/api/admin/role-permissions`, body).then(r => r.data),

    // Overrides
    listOverrides: (userId: string) =>
        api.get<{ success: boolean; data: { capabilities: UserOverride[]; crossDept: CrossDeptGrant[] } }>(`/api/admin/users/${userId}/overrides`).then(r => r.data.data),
    grant: (userId: string, body: { featureId: string; capabilityId: string; reason?: string | null; expiresAt?: string | null }) =>
        api.post(`/api/admin/users/${userId}/overrides/grant`, body).then(r => r.data),
    deny: (userId: string, body: { featureId: string; capabilityId: string; reason?: string | null; expiresAt?: string | null }) =>
        api.post(`/api/admin/users/${userId}/overrides/deny`, body).then(r => r.data),
    revoke: (userId: string, type: 'grant' | 'deny', featureId: string, capabilityId: string) =>
        api.delete(`/api/admin/users/${userId}/overrides/${type}/${featureId}/${capabilityId}`).then(r => r.data),
    grantCrossDept: (userId: string, body: { targetRoleKey: string; featureId: string; capabilityId: string; expiresAt?: string | null; notes?: string | null }) =>
        api.post(`/api/admin/users/${userId}/cross-dept-grants`, body).then(r => r.data),
    revokeCrossDept: (id: string) =>
        api.delete(`/api/admin/cross-dept-grants/${id}`).then(r => r.data),
};

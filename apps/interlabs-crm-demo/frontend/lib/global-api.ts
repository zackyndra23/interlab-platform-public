import { api, apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    CapabilityDefinition, ChatChannel, ChatMessage, EmailTemplate,
    EmailTemplateUpdateInput, FeatureDefinition, FileUploadResponse,
    NotificationListQuery, NotificationRow,
    PasswordChangeInput, PoStatusHistoryRow, PoTrackingRecord, PoTrackingSearchResult,
    RoleDefinition, RolePermissionsResponse,
    UserCreateInput, UserPreferencesUpdate, UserRow, UserUpdateInput, UUID,
} from './global-types';

/**
 * Typed wrappers around the global (cross-module) API endpoints described
 * in CTX_architecture.txt §API ROUTE MAP.
 *
 * Each surface here is consumed by exactly one global page:
 *   - notificationsApi      → /notifications
 *   - chatApi               → /chat
 *   - poTrackingApi         → /po-tracking
 *   - usersApi + rolesApi   → /setup/roles
 *   - emailTemplatesApi     → /setup/email-templates
 *   - settingsApi           → /settings
 */

// ===========================================================================
// NOTIFICATIONS
// ===========================================================================

export const notificationsApi = {
    /** Bell-dropdown call (limit=5, unread=true) and full list both go here. */
    list: (params?: NotificationListQuery) =>
        apiList<NotificationRow>(
            '/api/notifications', params as Record<string, unknown>,
        ),

    /** Full paginated list — same endpoint, different defaults. */
    listAll: (params?: NotificationListQuery) =>
        apiList<NotificationRow>(
            '/api/notifications/all', params as Record<string, unknown>,
        ),

    markRead: (id: UUID) =>
        apiPut<{ id: UUID; is_read: true }>(
            `/api/notifications/${id}/read`,
        ),

    markAllRead: () =>
        apiPut<{ updated: number }>('/api/notifications/read-all'),
};

// ===========================================================================
// CHAT
// ===========================================================================

export const chatApi = {
    listChannels: () => apiList<ChatChannel>('/api/chat/channels'),

    /** Cursor-style: pass `before` (message id or ISO timestamp) to page back. */
    listMessages: (channelId: UUID, params?: {
        before?: string;
        limit?: number;
    }) => apiList<ChatMessage>(
        `/api/chat/channels/${channelId}/messages`,
        params as Record<string, unknown>,
    ),

    /**
     * REST send — used as a fallback when the WebSocket isn't connected.
     * The real-time path is `websocket.send('chat:send_message', ...)`
     * which the chat page prefers.
     */
    sendMessage: (channelId: UUID, content: string, topicId?: UUID) =>
        apiPost<ChatMessage>(
            `/api/chat/channels/${channelId}/messages`,
            { content, topic_id: topicId ?? null },
        ),

    markRead: (messageId: UUID) =>
        apiPut<{ id: UUID; read_at: string }>(
            `/api/chat/messages/${messageId}/read`,
        ),
};

// ===========================================================================
// PO TRACKING
// ===========================================================================

export const poTrackingApi = {
    /** Paginated list of all POs with optional search + status filter. */
    list: (params?: { search?: string; status?: string; page?: number; limit?: number }) =>
        apiList<PoTrackingRecord>('/api/po-tracking', params as Record<string, unknown>),

    /** Search by exact PO number — returns a single record + latest 3 rows. */
    search: (poNumber: string) =>
        apiGet<PoTrackingSearchResult>(
            '/api/po-tracking/search', { po_number: poNumber },
        ),

    /** Full 11-stage history; Superadmin/CEO only at the route layer. */
    fullHistory: (poId: UUID) =>
        apiGet<PoStatusHistoryRow[]>(
            `/api/po-tracking/${poId}/history`,
        ),

    latest: (poId: UUID, limit = 3) =>
        apiGet<PoStatusHistoryRow[]>(
            `/api/po-tracking/${poId}/latest`, { limit },
        ),
};

// ===========================================================================
// USERS (Setup → Roles)
// ===========================================================================

export const usersApi = {
    list: (params?: { page?: number; limit?: number; role?: string; search?: string }) =>
        apiList<UserRow>('/api/users', params as Record<string, unknown>),

    get: (id: UUID) => apiGet<UserRow>(`/api/users/${id}`),

    create: (input: UserCreateInput) =>
        apiPost<UserRow>('/api/users', input),

    update: (id: UUID, input: UserUpdateInput) =>
        apiPut<UserRow>(`/api/users/${id}`, input),

    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`/api/users/${id}`),
};

// ===========================================================================
// ROLES + PERMISSIONS
// ===========================================================================

export const rolesApi = {
    list: () => apiList<RoleDefinition>('/api/roles'),

    create: (input: { role_key: string; role_name: string; description?: string }) =>
        apiPost<RoleDefinition>('/api/roles', input),

    update: (id: UUID, input: Partial<{
        role_name: string;
        description: string | null;
    }>) => apiPut<RoleDefinition>(`/api/roles/${id}`, input),

    /** Returns the role + map of feature_key → capability_keys[]. */
    getPermissions: (id: UUID) =>
        apiGet<RolePermissionsResponse>(`/api/roles/${id}/permissions`),

    setPermissions: (id: UUID, permissions: Record<string, string[]>) =>
        apiPut<{ updated: number }>(
            `/api/roles/${id}/permissions`, { permissions },
        ),
};

export const permissionsApi = {
    listFeatures: () =>
        apiGet<FeatureDefinition[]>('/api/permissions/features'),

    listCapabilities: () =>
        apiGet<CapabilityDefinition[]>('/api/permissions/capabilities'),
};

// ===========================================================================
// EMAIL TEMPLATES
// ===========================================================================

export const emailTemplatesApi = {
    list: () => apiList<EmailTemplate>('/api/email-templates'),

    update: (id: UUID, input: EmailTemplateUpdateInput) =>
        apiPut<EmailTemplate>(`/api/email-templates/${id}`, input),

    enable: (id: UUID) =>
        apiPut<EmailTemplate>(`/api/email-templates/${id}/enable`),

    disable: (id: UUID) =>
        apiPut<EmailTemplate>(`/api/email-templates/${id}/disable`),

    enableGroup: (groupKey: string) =>
        apiPut<{ updated: number }>(
            `/api/email-templates/group/${encodeURIComponent(groupKey)}/enable-all`,
        ),

    disableGroup: (groupKey: string) =>
        apiPut<{ updated: number }>(
            `/api/email-templates/group/${encodeURIComponent(groupKey)}/disable-all`,
        ),
};

// ===========================================================================
// SETTINGS
// ===========================================================================

export const settingsApi = {
    /** Profile updates (display_name) reuse PUT /api/users/:id.
     *  Note: avatar changes go through the dedicated avatar upload flow
     *  (POST /api/users/me/avatar/presign → presign → commit). */
    updateProfile: (id: UUID, input: { display_name?: string }) =>
        apiPut<UserRow>(`/api/users/${id}`, input),

    changePassword: (input: PasswordChangeInput) =>
        apiPut<{ updated: true }>('/api/auth/password', input),

    updatePreferences: (input: UserPreferencesUpdate) =>
        apiPut<{ updated: true }>('/api/auth/preferences', input),
};

// ===========================================================================
// FILES (avatar upload reuses the shared file pipeline)
// ===========================================================================

export const filesApi = {
    /**
     * Upload a single file. We bypass the apiPost helper because we need
     * multipart encoding rather than JSON, but we still go through the
     * Axios instance so the JWT interceptor attaches the bearer token.
     */
    async upload(
        file: File,
        relatedModule: string,
        relatedEntityId?: string | null,
    ): Promise<FileUploadResponse> {
        const form = new FormData();
        form.append('file', file);
        form.append('related_module', relatedModule);
        if (relatedEntityId) form.append('related_entity_id', relatedEntityId);
        const res = await api.post('/api/files/upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (!res.data.success) throw new Error(res.data.error || 'Upload failed');
        return res.data.data as FileUploadResponse;
    },

    presignedUrl: (id: UUID) =>
        apiGet<{ url: string }>(`/api/files/${id}/presigned-url`),
};

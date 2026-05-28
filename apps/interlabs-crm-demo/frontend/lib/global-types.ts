/**
 * Shared types for the global pages — Notifications, Chat, PO Tracking,
 * Roles & Users, Email Templates, Settings.
 *
 * Backend contract: CTX_architecture.txt §API ROUTE MAP and §WEBSOCKET
 * EVENT CATALOGUE. Field names mirror the columns those routes are
 * expected to return so payloads map 1:1.
 */

import type { UUID, ISODate, ISODateTime } from './sales-types';
import type { RoleKey } from './rbac';

export type { UUID, ISODate, ISODateTime, RoleKey };

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------

export type NotificationRow = {
    id: UUID;
    title: string;
    message: string | null;
    related_module: string | null;
    related_entity_type: string | null;
    related_entity_id: string | null;
    sender_user_id: UUID | null;
    recipient_user_id: UUID | null;
    recipient_role: RoleKey | null;
    is_read: boolean;
    created_at: ISODateTime;
};

export type NotificationListQuery = {
    page?: number;
    limit?: number;
    /** is_read=true → read only; false → unread only; omit → all. */
    is_read?: boolean;
    related_module?: string;
};

// ---------------------------------------------------------------------------
// CHAT
// ---------------------------------------------------------------------------

/**
 * One channel as listed on the left column of /chat. The backend joins
 * `chat_channels` with the caller's `chat_channel_members` row to surface
 * `unread_count` and `last_message_*`.
 */
export type ChatChannel = {
    id: UUID;
    /** 'role:sales', 'role:finance', 'direct:<user_id>', or 'topic:<...>' */
    channel_key: string;
    channel_type: 'role' | 'direct' | 'topic';
    title: string;
    description: string | null;
    role_scope: RoleKey | null;
    member_count: number;
    unread_count: number;
    last_message_preview: string | null;
    last_message_at: ISODateTime | null;
    created_at: ISODateTime;
};

export type ChatMessage = {
    id: UUID;
    channel_id: UUID;
    topic_id: UUID | null;
    sender_user_id: UUID;
    sender_name: string | null;
    sender_avatar_url: string | null;
    content: string;
    created_at: ISODateTime;
};

/** WebSocket payload shape for `chat:message` (matches handlers.js). */
export type ChatMessagePush = {
    channel_id: UUID;
    message_id: UUID;
    topic_id: UUID | null;
    sender_id: UUID;
    sender_name: string | null;
    content: string;
    created_at: ISODateTime;
};

export type ChatUnreadUpdatePush = {
    channel_id: UUID;
    unread_count: number;
};

// ---------------------------------------------------------------------------
// PO TRACKING
// ---------------------------------------------------------------------------

export type PoTrackingStatus =
    | 'Registered' | 'Processed' | 'Production' | 'Shipped' | 'Customs'
    | 'Arrived' | 'Inspected' | 'Delivery' | 'Installation' | 'BAST'
    | 'Invoice';

export type PoTrackingRecord = {
    id: UUID;
    po_number: string;
    current_status: PoTrackingStatus;
    customer_id: UUID | null;
    customer_name: string | null;
    created_by_user_id: UUID | null;
    created_by_role: RoleKey | null;
    due_at: ISODateTime | null;
    overdue_at: ISODateTime | null;
    overdue_reason: string | null;
    escalation_sent_at: ISODateTime | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
};

export type PoStatusHistoryRow = {
    id: UUID;
    po_id: UUID;
    po_number: string;
    status_code: string;
    status_label: PoTrackingStatus;
    updated_by_user_id: UUID | null;
    updated_by_role: RoleKey | null;
    updated_by_name: string | null;
    note: string | null;
    reason_if_delayed: string | null;
    attachment_url: string | null;
    created_at: ISODateTime;
};

export type PoTrackingSearchResult = {
    po: PoTrackingRecord;
    /** Latest 3 movements by default. */
    history: PoStatusHistoryRow[];
};

export type PoStatusUpdatePush = {
    po_id: UUID;
    po_number: string;
    new_status: PoTrackingStatus;
    updated_by_role: RoleKey;
    updated_at: ISODateTime;
};

// ---------------------------------------------------------------------------
// USERS / ROLES (Setup → Roles)
// ---------------------------------------------------------------------------

export type AccountStatus = 'active' | 'inactive' | 'suspended';

export type UserRow = {
    id: UUID;
    email: string;
    display_name: string;
    role: RoleKey;
    permission_level: string | null;
    avatar_url: string | null;
    account_status: AccountStatus;
    managed_role_scope: RoleKey | null;
    can_manage_same_role: boolean;
    feature_permission_scope: string | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    created_by: UUID | null;
    updated_by: UUID | null;
};

export type UserCreateInput = {
    email: string;
    display_name: string;
    password: string;
    role: RoleKey;
    permission_level?: string | null;
    account_status?: AccountStatus;
    managed_role_scope?: RoleKey | null;
    can_manage_same_role?: boolean;
    feature_permission_scope?: string | null;
};

export type UserUpdateInput = Partial<Omit<UserCreateInput, 'password'>>;

export type RoleDefinition = {
    id: UUID;
    role_key: RoleKey | string;
    role_name: string;
    description: string | null;
    is_system: boolean;
    created_at: ISODateTime;
};

export type FeatureDefinition = {
    feature_key: string;
    feature_name: string;
    module_group: string;
};

export type CapabilityDefinition = {
    capability_key: string;
    capability_name: string;
};

export type RolePermissionsResponse = {
    role: RoleDefinition;
    /** Map of feature_key → capability_keys[]. */
    permissions: Record<string, string[]>;
};

// ---------------------------------------------------------------------------
// EMAIL TEMPLATES
// ---------------------------------------------------------------------------

export type EmailTemplate = {
    id: UUID;
    template_key: string;
    template_name: string;
    feature_group: string;
    trigger_event: string;
    recipient_roles_json: RoleKey[];
    send_email_enabled: boolean;
    send_dashboard_notification_enabled: boolean;
    status: 'enabled' | 'disabled';
    subject: string | null;
    body: string | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
};

export type EmailTemplateUpdateInput = Partial<{
    subject: string | null;
    body: string | null;
    send_email_enabled: boolean;
    send_dashboard_notification_enabled: boolean;
    recipient_roles_json: RoleKey[];
}>;

// ---------------------------------------------------------------------------
// SETTINGS / PROFILE
// ---------------------------------------------------------------------------

export type PasswordChangeInput = {
    current_password: string;
    new_password: string;
};

export type UserPreferencesUpdate = {
    theme?: 'light' | 'dark';
    sidebar_collapsed?: boolean;
};

export type FileUploadResponse = {
    id: UUID;
    original_filename: string;
    mime_type: string | null;
    size_bytes?: number | null;
    storage_path?: string;
    storage_bucket?: string;
    created_at?: ISODateTime;
};

/**
 * RBAC helpers — mirror the backend's role model so the UI can gate menus
 * and buttons without a per-render server round-trip. These checks are
 * convenience only; the backend remains authoritative and will 403 any
 * action the frontend erroneously allows.
 *
 * The 8 system roles are fixed in migration 002 `roles` seeding.
 */

export type RoleKey =
    | 'superadmin'
    | 'ceo'
    | 'sales'
    | 'admin_log'
    | 'finance'
    | 'technical'
    | 'hrga'
    | 'tax_insurance';

export const ROLE_LABEL: Record<RoleKey, string> = {
    superadmin: 'Superadmin',
    ceo: 'CEO',
    sales: 'Sales',
    admin_log: 'Admin & Log',
    finance: 'Finance',
    technical: 'Technical',
    hrga: 'HRGA / Legal',
    tax_insurance: 'Tax & Insurance',
};

export type UserProfile = {
    id: string;
    email: string;
    role: RoleKey;
    permission_level: string | null;
    // avatar_url is no longer returned by loadProfile / /api/auth/me.
    // Avatars are resolved via GET /api/users/:id/avatar (presigned MinIO URL)
    // through the <AvatarDisplay /> component. Do not rely on this field.
    /** @deprecated Use <AvatarDisplay userId={id} /> instead. */
    avatar_url?: string | null;
    display_name: string;
    account_status: 'active' | 'inactive' | 'suspended';
    managed_role_scope: string | null;
    can_manage_same_role: boolean;
    feature_permission_scope: string | null;
    must_change_password: boolean;
};

/** Superadmin + CEO see everything and bypass same-role scoping. */
export function isGlobalRole(role: RoleKey | undefined): boolean {
    return role === 'superadmin' || role === 'ceo';
}

/** Can this user view / act on a target user with the given role? */
export function canManageRole(actor: UserProfile, targetRole: RoleKey): boolean {
    if (isGlobalRole(actor.role)) return true;
    if (!actor.can_manage_same_role) return false;
    const scoped = actor.managed_role_scope || actor.role;
    return scoped === targetRole;
}

/**
 * Best-effort feature gate. The backend is still authoritative; this is a
 * UI-only check used to hide menu items and disable buttons. If the caller
 * can't enumerate their capabilities, default to showing the item so the
 * user hits the server and sees the real 403 rather than a silent hide.
 */
export function hasFeatureAccess(
    role: RoleKey | undefined,
    feature: string,
    capability: 'view_own' | 'view_global' | 'create' | 'edit' | 'delete' | 'write' | 'export' | 'approve' | 'full_access',
): boolean {
    if (!role) return false;
    if (isGlobalRole(role)) return true;
    return roleOwnsFeature(role, feature, capability);
}

/**
 * Hardcoded mirror of the default permission matrix — keeps the UI gates
 * predictable even before the backend /api/permissions/features endpoint
 * is wired. The REAL authority is still `role_permissions` on the server;
 * this map is a rendering hint only.
 */
function roleOwnsFeature(
    role: RoleKey,
    feature: string,
    _capability: string,
): boolean {
    const ownership: Record<RoleKey, string[]> = {
        superadmin: ['*'],
        ceo: ['*'],
        sales: [
            'sales_forecast', 'quotation', 'harga_pokok_penjualan',
            'sales_po', 'purchase_request', 'customer',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
        admin_log: [
            'awb', 'delivery_order', 'admin_operational',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
        finance: [
            'po_customer', 'purchase_requisition', 'invoice_manufacture',
            'invoice_customer',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
        technical: [
            'technical_job_order', 'installation', 'pm', 'sparepart',
            'inspection_qc', 'bast',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
        hrga: [
            'hrga_legal', 'company_letters', 'hrga_archive', 'hrga_compliance',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
        tax_insurance: [
            'tax_operational',
            'notifications', 'chat', 'po_tracking', 'roles_management',
            'email_templates',
        ],
    };
    const allowed = ownership[role] || [];
    return allowed.includes('*') || allowed.includes(feature);
}

export type RoleKey = 'sales' | 'admin_log' | 'finance' | 'technical' | 'hrga' | 'tax_insurance' | 'superadmin' | 'ceo';

export interface RoleLevel {
    id: string;
    role_id: string;
    level_key: string;
    level_name: string;
    level_rank: number;
    data_scope_default: 'own' | 'team' | 'role' | 'global';
}

export interface FeatureDef {
    id: string;
    feature_key: string;
    feature_name: string;
    module_group: string;
}

export interface CapabilityDef {
    id: string;
    capability_key: string;
    capability_name: string;
}

export interface RolePermissionRow {
    role_id: string;
    level_id: string;
    feature_id: string;
    capability_id: string;
}

export interface UserOverride {
    id: string;
    feature_key: string;
    capability_key: string;
    override_type: 'grant' | 'deny';
    expires_at: string | null;
    revoked_at: string | null;
    reason: string | null;
}

export interface CrossDeptGrant {
    id: string;
    target_role_key: string;
    feature_key: string;
    capability_key: string;
    expires_at: string | null;
    notes: string | null;
}

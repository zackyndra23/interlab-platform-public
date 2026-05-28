import type { RoleKey } from './admin-permissions-types';

export const ROLE_KEYS: ReadonlyArray<RoleKey> = [
    'sales', 'admin_log', 'finance', 'technical', 'hrga', 'tax_insurance',
] as const;

export const ROLE_LABELS: Record<RoleKey, string> = {
    sales: 'Sales',
    admin_log: 'Admin & Log',
    finance: 'Finance',
    technical: 'Technical',
    hrga: 'HRGA',
    tax_insurance: 'Tax & Insurance',
    superadmin: 'Superadmin',
    ceo: 'CEO',
};

export const SCOPE_LABELS: Record<string, string> = {
    own: 'Own',
    team: 'Team',
    role: 'Role',
    global: 'Global',
};

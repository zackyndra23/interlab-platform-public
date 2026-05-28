'use client';

import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABEL } from '@/lib/rbac';
import { SalesDashboard } from '@/components/sales/widgets/SalesDashboard';
import { AdminLogDashboard } from '@/components/admin-log/widgets/AdminLogDashboard';
import { FinanceDashboard } from '@/components/finance/widgets/FinanceDashboard';
import { TechnicalDashboard } from '@/components/technical/widgets/TechnicalDashboard';
import { HrgaDashboard } from '@/components/hrga/widgets/HrgaDashboard';
import { TaxDashboard } from '@/components/tax/widgets/TaxDashboard';
import { SharedDashboardHeader } from '@/components/dashboard/SharedDashboardHeader';

/**
 * Role-aware /dashboard page. Renders the F7 shared widgets (Recent
 * Notifications + PO Quick Search) above the role-specific composer for
 * every authenticated user. Superadmin/CEO get every division stacked
 * until the dedicated /api/dashboard/{superadmin,ceo} aggregate endpoints
 * ship.
 */
export default function DashboardPage() {
    const { user } = useAuth();
    if (!user) return null;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold">Welcome, {user.display_name}</h2>
                <p className="text-xs text-muted-foreground">
                    Signed in as {ROLE_LABEL[user.role]}.
                </p>
            </div>

            <SharedDashboardHeader />

            <RoleDashboard role={user.role} />
        </div>
    );
}

function RoleDashboard({ role }: { role: string }) {
    switch (role) {
        case 'sales':         return <SalesDashboard />;
        case 'admin_log':     return <AdminLogDashboard />;
        case 'finance':       return <FinanceDashboard />;
        case 'technical':     return <TechnicalDashboard />;
        case 'hrga':          return <HrgaDashboard />;
        case 'tax_insurance': return <TaxDashboard />;
        case 'superadmin':
        case 'ceo':
            return (
                <div className="space-y-6">
                    <Section title="Sales"><SalesDashboard /></Section>
                    <Section title="Admin & Log"><AdminLogDashboard /></Section>
                    <Section title="Finance"><FinanceDashboard /></Section>
                    <Section title="Technical"><TechnicalDashboard /></Section>
                    <Section title="HRGA / Legal"><HrgaDashboard /></Section>
                    <Section title="Tax & Insurance"><TaxDashboard /></Section>
                </div>
            );
        default:
            return (
                <p className="text-xs text-muted-foreground">
                    Dashboard for this role has not been generated yet.
                </p>
            );
    }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</h3>
            {children}
        </div>
    );
}

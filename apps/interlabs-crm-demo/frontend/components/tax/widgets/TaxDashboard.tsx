'use client';

import { CurrentMasaPajakWidget } from './CurrentMasaPajakWidget';
import { MonthlySummaryWidget } from './MonthlySummaryWidget';
import { PpnSummaryWidget } from './PpnSummaryWidget';
import { RecentTaxActivityWidget } from './RecentTaxActivityWidget';
import { PendingActionsWidget } from './PendingActionsWidget';

/**
 * Tax & Insurance dashboard composer. Mounted from /dashboard for the
 * tax_insurance role (and aggregated for Superadmin / CEO). Widget order
 * follows MOD_tax_insurance §DASHBOARD WIDGETS.
 */
export function TaxDashboard() {
    return (
        <div className="space-y-4">
            <CurrentMasaPajakWidget />

            <div className="grid gap-4 md:grid-cols-2">
                <MonthlySummaryWidget taxType="PPh 21" />
                <MonthlySummaryWidget taxType="PPh 25" />
            </div>

            <PpnSummaryWidget />

            <div className="grid gap-4 md:grid-cols-2">
                <RecentTaxActivityWidget />
                <PendingActionsWidget />
            </div>
        </div>
    );
}

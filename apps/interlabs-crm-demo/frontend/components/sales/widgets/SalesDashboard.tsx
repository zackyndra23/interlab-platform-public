'use client';

import { PoPipelineWidget } from './PoPipelineWidget';
import { ForecastPipelineWidget } from './ForecastPipelineWidget';
import { QuotationStatusWidget } from './QuotationStatusWidget';
import { SlaAlertsWidget } from './SlaAlertsWidget';
import { RecentActivityWidget } from './RecentActivityWidget';

/**
 * Sales-role dashboard composer. The /dashboard route in Phase F7 will
 * detect the signed-in role and render this when the user is Sales (or
 * when Superadmin/CEO select the Sales slice). Until then, the
 * component is importable from the dashboard stub for manual testing.
 */
export function SalesDashboard() {
    return (
        <div className="space-y-4">
            <SlaAlertsWidget />
            <div className="grid gap-4 md:grid-cols-2">
                <PoPipelineWidget />
                <QuotationStatusWidget />
                <ForecastPipelineWidget />
                <RecentActivityWidget />
            </div>
        </div>
    );
}

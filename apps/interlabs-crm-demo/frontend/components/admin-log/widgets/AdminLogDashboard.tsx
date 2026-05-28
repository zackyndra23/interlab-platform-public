'use client';

import { PoStageStatusWidget } from './PoStageStatusWidget';
import { AwbActiveWidget } from './AwbActiveWidget';
import { DoPendingWidget } from './DoPendingWidget';
import { ReadyToDeliverAlertsWidget } from './ReadyToDeliverAlertsWidget';
import { MonthlyOperationalWidget } from './MonthlyOperationalWidget';

/**
 * Admin & Log dashboard composer. Mounted by the Phase F7 /dashboard
 * route for Admin & Log / Superadmin / CEO users. Until then, imported
 * by the dashboard stub for manual testing.
 */
export function AdminLogDashboard() {
    return (
        <div className="space-y-4">
            <ReadyToDeliverAlertsWidget />
            <PoStageStatusWidget />
            <div className="grid gap-4 md:grid-cols-2">
                <AwbActiveWidget />
                <DoPendingWidget />
                <MonthlyOperationalWidget />
            </div>
        </div>
    );
}

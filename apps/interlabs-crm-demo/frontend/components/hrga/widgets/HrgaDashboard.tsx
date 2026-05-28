'use client';

import { ComplianceAlertWidget } from './ComplianceAlertWidget';
import { LettersByStatusWidget } from './LettersByStatusWidget';
import { RecentDocumentsWidget } from './RecentDocumentsWidget';
import { SmartSearchQuickAccessWidget } from './SmartSearchQuickAccessWidget';
import { UpcomingRenewalsWidget } from './UpcomingRenewalsWidget';

/**
 * HRGA dashboard composer. Mounted by the Phase F7 /dashboard route for
 * HRGA / Superadmin / CEO users. Order follows MOD_hrga §DASHBOARD WIDGETS.
 */
export function HrgaDashboard() {
    return (
        <div className="space-y-4">
            <ComplianceAlertWidget />
            <SmartSearchQuickAccessWidget />
            <div className="grid gap-4 md:grid-cols-2">
                <RecentDocumentsWidget />
                <LettersByStatusWidget />
            </div>
            <UpcomingRenewalsWidget />
        </div>
    );
}

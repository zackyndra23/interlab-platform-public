'use client';

import { PoQuickSearchCard } from './PoQuickSearchCard';
import { RecentNotificationsCard } from './RecentNotificationsCard';

/**
 * F7 §"Shared widgets (available to all roles)" composer. Rendered above
 * the role-specific dashboard so every signed-in user — regardless of
 * role — sees the latest notifications and a one-click PO lookup.
 */
export function SharedDashboardHeader() {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <RecentNotificationsCard />
            <PoQuickSearchCard />
        </div>
    );
}

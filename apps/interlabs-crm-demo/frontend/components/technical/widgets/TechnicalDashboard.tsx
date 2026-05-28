'use client';

import { ActiveJobOrdersWidget } from './ActiveJobOrdersWidget';
import { PoStageBoardWidget } from './PoStageBoardWidget';
import { ReadyToDeliverPendingWidget } from './ReadyToDeliverPendingWidget';
import { QcQueueWidget } from './QcQueueWidget';
import { BastPendingFinanceWidget } from './BastPendingFinanceWidget';

/**
 * Technical dashboard composer. Mounted by the Phase F7 /dashboard route
 * for Technical / Superadmin / CEO users. Order follows MOD_technical
 * §DASHBOARD WIDGETS.
 */
export function TechnicalDashboard() {
    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <ActiveJobOrdersWidget />
                <PoStageBoardWidget />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <ReadyToDeliverPendingWidget />
                <QcQueueWidget />
            </div>
            <BastPendingFinanceWidget />
        </div>
    );
}

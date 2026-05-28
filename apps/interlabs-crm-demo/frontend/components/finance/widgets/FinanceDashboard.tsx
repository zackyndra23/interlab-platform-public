'use client';

import { PoProductionBoardWidget } from './PoProductionBoardWidget';
import { PoInvoiceBoardWidget } from './PoInvoiceBoardWidget';
import { InvoiceManufactureTrackerWidget } from './InvoiceManufactureTrackerWidget';
import { InvoiceCustomerPendingWidget } from './InvoiceCustomerPendingWidget';
import { PurchaseRequisitionBoardWidget } from './PurchaseRequisitionBoardWidget';

/**
 * Finance dashboard composer. Mounted by the Phase F7 /dashboard route
 * for Finance / Superadmin / CEO users.
 */
export function FinanceDashboard() {
    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <PoProductionBoardWidget />
                <PoInvoiceBoardWidget />
            </div>
            <InvoiceManufactureTrackerWidget />
            <div className="grid gap-4 md:grid-cols-2">
                <InvoiceCustomerPendingWidget />
                <PurchaseRequisitionBoardWidget />
            </div>
        </div>
    );
}

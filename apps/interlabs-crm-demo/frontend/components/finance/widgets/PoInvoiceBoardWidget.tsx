'use client';

import { useEffect, useState } from 'react';

import { poCustomersApi } from '@/lib/finance-api';
import type { PoCustomer } from '@/lib/finance-types';

/**
 * Widget 4: PO Invoice Status Board (MOD_finance §WIDGETS).
 * Invoice-stage PO Customer count + Completed (fully invoiced) count.
 */
export function PoInvoiceBoardWidget() {
    const [rows, setRows] = useState<PoCustomer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        poCustomersApi.list({ limit: 200 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const invoiceStage = rows.filter((r) => r.current_po_status === 'Invoice').length;
    const completed = rows.filter((r) => r.workflow_status === 'completed').length;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">PO Invoice Board</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <p className="text-2xl font-semibold">{invoiceStage}</p>
                        <p className="text-xs text-muted-foreground">POs in Invoice</p>
                    </div>
                    <div>
                        <p className="text-2xl font-semibold">{completed}</p>
                        <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                </div>
            )}
        </section>
    );
}

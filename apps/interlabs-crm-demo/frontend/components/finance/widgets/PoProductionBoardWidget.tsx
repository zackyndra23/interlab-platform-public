'use client';

import { useEffect, useState } from 'react';

import { invoiceManufacturesApi, poCustomersApi } from '@/lib/finance-api';
import { isOverdueDueDate } from '@/lib/finance-ui';
import type {
    InvoiceManufacture, PoCustomer,
} from '@/lib/finance-types';

/**
 * Widget 1: PO Production Status Board (MOD_finance §WIDGETS).
 *
 * Counts PO Customer rows currently in the Production phase + unpaid
 * Invoice Manufacture rows whose due_date has passed. Pulled from list
 * endpoints (`limit=100`); swap to `/api/dashboard/finance` when the
 * dedicated endpoint arrives.
 */
export function PoProductionBoardWidget() {
    const [pos, setPos] = useState<PoCustomer[]>([]);
    const [invoices, setInvoices] = useState<InvoiceManufacture[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [p, i] = await Promise.all([
                    poCustomersApi.list({ limit: 200 }),
                    invoiceManufacturesApi.list({ limit: 200 }),
                ]);
                setPos(p.rows);
                setInvoices(i.rows);
            } catch {
                setPos([]); setInvoices([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const production = pos.filter((p) => p.current_po_status === 'Production').length;
    const overdue = invoices.filter((i) =>
        i.payment_status === 'Unpaid' && isOverdueDueDate(i.due_date)).length;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">PO Production Board</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label="POs in Production" value={production} />
                    <Stat label="Overdue Invoices" value={overdue} danger={overdue > 0} />
                </div>
            )}
        </section>
    );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
    return (
        <div>
            <p className={`text-2xl font-semibold ${danger ? 'text-destructive' : ''}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

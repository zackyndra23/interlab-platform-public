'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { invoiceManufacturesApi } from '@/lib/finance-api';
import { invoiceMfgPaymentVariant, isOverdueDueDate } from '@/lib/finance-ui';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceManufacture } from '@/lib/finance-types';

/**
 * Widget 2: Invoice Manufacture Tracker. Lists unpaid invoices sorted
 * ascending by due_date so overdue ones bubble to the top. Links each
 * row to the detail page for Record Payment action.
 */
export function InvoiceManufactureTrackerWidget() {
    const [rows, setRows] = useState<InvoiceManufacture[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        invoiceManufacturesApi.list({ payment_status: 'Unpaid', limit: 100 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const sorted = rows
        .slice()
        .sort((a, b) => {
            const ad = a.due_date || '';
            const bd = b.due_date || '';
            return ad < bd ? -1 : 1;
        })
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Invoice Manufacture — Unpaid</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">All invoices paid</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {sorted.map((r) => {
                        const overdue = isOverdueDueDate(r.due_date);
                        return (
                            <li key={r.id} className="flex items-center justify-between">
                                <div className="min-w-0">
                                    <Link href={`/finance/invoice-manufactures/${r.id}`} className="text-primary hover:underline">
                                        {r.invoice_number || r.invoice_manufacture_record_number}
                                    </Link>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {r.supplier_or_manufacturer || '—'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs ${overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                                        Due {formatDate(r.due_date) || '—'}
                                    </span>
                                    <span className="text-xs font-medium">
                                        {formatCurrency(r.total_amount, r.currency)}
                                    </span>
                                    <StatusBadge
                                        status={r.payment_status}
                                        variant={invoiceMfgPaymentVariant(r.payment_status)}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

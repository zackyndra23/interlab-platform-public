'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { invoiceCustomersApi } from '@/lib/finance-api';
import { formatDate } from '@/lib/utils';
import type { InvoiceCustomer } from '@/lib/finance-types';

/**
 * Widget 3: Invoice Customer Pending. Lists drafts with
 * `invoice_status='Registered'` — Finance hasn't issued the customer
 * invoice yet. Each row links to the detail page where the
 * UploadInvoicePanel lives.
 */
export function InvoiceCustomerPendingWidget() {
    const [rows, setRows] = useState<InvoiceCustomer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        invoiceCustomersApi.list({ invoice_status: 'Registered', limit: 100 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const sorted = rows
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Invoice Customer — Awaiting Issue</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending drafts</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {sorted.map((r) => (
                        <li key={r.id} className="flex items-center justify-between">
                            <div className="min-w-0">
                                <Link href={`/finance/invoice-customers/${r.id}`} className="text-primary hover:underline">
                                    {r.invoice_customer_record_number}
                                </Link>
                                {r.related_bast_id && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        BAST {r.related_bast_id.slice(0, 8)}
                                    </span>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                                Registered {formatDate(r.created_at)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

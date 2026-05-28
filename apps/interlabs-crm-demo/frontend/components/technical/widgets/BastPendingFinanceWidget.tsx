'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { bastApi } from '@/lib/technical-api';
import { invoiceCustomersApi } from '@/lib/finance-api';
import { formatDate } from '@/lib/utils';
import type { BastRecord } from '@/lib/technical-types';
import type { InvoiceCustomer } from '@/lib/finance-types';

/**
 * Widget 5 (MOD_technical §WIDGETS): BAST records sent to Finance whose
 * auto-created Invoice Customer draft is still sitting at 'Registered'
 * (i.e. Finance has not yet issued the invoice).
 *
 * Joins client-side on related_bast_id. When the dedicated dashboard
 * endpoint is wired, replace with /api/dashboard/technical → bast_pending_finance.
 */
export function BastPendingFinanceWidget() {
    const [pending, setPending] = useState<BastRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [b, inv] = await Promise.all([
                    bastApi.list({ workflow_status: 'sent_to_finance', limit: 100 }),
                    invoiceCustomersApi.list({ limit: 200 }),
                ]);
                const registered = new Set<string>(
                    inv.rows
                        .filter((i: InvoiceCustomer) => i.invoice_status === 'Registered' && i.related_bast_id)
                        .map((i) => i.related_bast_id as string),
                );
                setPending(b.rows.filter((r) => registered.has(r.id)));
            } catch {
                setPending([]);
            } finally { setLoading(false); }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">BAST · Pending Finance Acknowledgement</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    All submitted BAST records have been actioned by Finance.
                </p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {pending.slice(0, 8).map((b) => (
                        <li key={b.id} className="flex items-center justify-between px-3 py-2">
                            <Link href={`/technical/bast/${b.id}`} className="hover:underline">
                                <span className="font-medium">{b.bast_record_number}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{b.job_type || '—'}</span>
                            </Link>
                            <span className="text-xs text-muted-foreground">
                                Sent {formatDate(b.sent_to_finance_at) || '—'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

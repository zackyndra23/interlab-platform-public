'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { purchaseRequisitionsApi } from '@/lib/finance-api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { prStatusVariant } from '@/lib/finance-ui';
import { formatDate } from '@/lib/utils';
import type { PurchaseRequisition } from '@/lib/finance-types';

/**
 * Widget 5: Purchase Requisition Board.
 * Count by status + inline list of Registered PRs awaiting PO-Out.
 */
export function PurchaseRequisitionBoardWidget() {
    const [rows, setRows] = useState<PurchaseRequisition[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        purchaseRequisitionsApi.list({ limit: 200 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const registered = rows.filter((r) => r.current_pr_status === 'Registered');
    const processed = rows.filter((r) => r.current_pr_status === 'Processed').length;
    const awaiting = registered
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Purchase Requisitions</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <>
                    <div className="mb-3 flex gap-3 text-sm">
                        <div className="flex items-center gap-1.5">
                            <StatusBadge status="Registered" variant={prStatusVariant('Registered')} />
                            <span className="font-semibold">{registered.length}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <StatusBadge status="Processed" variant={prStatusVariant('Processed')} />
                            <span className="font-semibold">{processed}</span>
                        </div>
                    </div>
                    {awaiting.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nothing awaiting PO Out</p>
                    ) : (
                        <>
                            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                                Awaiting PO Out
                            </p>
                            <ul className="space-y-1 text-sm">
                                {awaiting.map((r) => (
                                    <li key={r.id} className="flex items-center justify-between">
                                        <Link href={`/finance/purchase-requisitions/${r.id}`} className="text-primary hover:underline">
                                            {r.pr_record_number}
                                        </Link>
                                        <span className="text-xs text-muted-foreground">
                                            {r.supplier_or_manufacturer || '—'} · {formatDate(r.created_at)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </>
            )}
        </section>
    );
}

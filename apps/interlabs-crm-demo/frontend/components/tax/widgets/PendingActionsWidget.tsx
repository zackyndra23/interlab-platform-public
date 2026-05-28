'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { taxDashboardApi } from '@/lib/tax-api';
import { formatMasaPajak } from '@/lib/tax-ui';
import { formatDate, relativeTime } from '@/lib/utils';
import type { DashboardPendingActions } from '@/lib/tax-types';

/**
 * Widget 6 (MOD_tax_insurance §DASHBOARD WIDGETS): Pending Actions.
 *
 *   - Drafts older than 7 days
 *   - Unpaid records whose payment_date has already passed
 *   - SPT obligations with no reporting_date for a closed Masa Pajak
 *
 * Each row links to the record detail page for the Tax team to act on.
 */
export function PendingActionsWidget() {
    const [data, setData] = useState<DashboardPendingActions | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        taxDashboardApi.pendingActions()
            .then(setData)
            .catch(() => setData(null))
            .finally(() => setLoading(false));
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
                Pending Actions
            </h3>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !data ? (
                <p className="text-sm text-muted-foreground">Could not load.</p>
            ) : (
                <div className="space-y-3">
                    <Bucket
                        title={`Drafts Older than 7 Days (${data.drafts_over_7d.length})`}
                        empty="No stale drafts."
                    >
                        {data.drafts_over_7d.map((r) => (
                            <Row key={r.id} href={`/tax/operational/${r.id}`}
                                left={`${r.tax_operational_record_number} · ${r.tax_type}`}
                                right={relativeTime(r.created_at)}
                            />
                        ))}
                    </Bucket>

                    <Bucket
                        title={`Unpaid Past Payment Date (${data.unpaid_past_payment_date.length})`}
                        empty="No overdue payments."
                    >
                        {data.unpaid_past_payment_date.map((r) => (
                            <Row key={r.id} href={`/tax/operational/${r.id}`}
                                left={`${r.tax_operational_record_number} · ${r.tax_type}`}
                                right={`due ${formatDate(r.payment_date)}`}
                            />
                        ))}
                    </Bucket>

                    <Bucket
                        title={`SPT Missing for Closed Masa Pajak (${data.spt_missing_for_closed_masa_pajak.length})`}
                        empty="All SPT filings are up to date."
                    >
                        {data.spt_missing_for_closed_masa_pajak.map((r) => (
                            <Row key={r.id} href={`/tax/operational/${r.id}`}
                                left={`${r.tax_operational_record_number} · ${r.tax_type}`}
                                right={formatMasaPajak(r.masa_pajak_month, r.masa_pajak_year)}
                            />
                        ))}
                    </Bucket>
                </div>
            )}
        </section>
    );
}

function Bucket({
    title, empty, children,
}: {
    title: string;
    empty: string;
    children?: React.ReactNode;
}) {
    const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
    return (
        <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
            {hasChildren ? (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {children}
                </ul>
            ) : (
                <p className="text-xs text-muted-foreground">{empty}</p>
            )}
        </div>
    );
}

function Row({ href, left, right }: { href: string; left: string; right: string }) {
    return (
        <li className="flex items-center justify-between gap-2 px-3 py-2">
            <Link href={href} className="min-w-0 flex-1 truncate hover:underline">
                {left}
            </Link>
            <span className="text-xs tabular-nums text-muted-foreground">{right}</span>
        </li>
    );
}

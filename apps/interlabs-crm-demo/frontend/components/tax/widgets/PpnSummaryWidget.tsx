'use client';

import { useEffect, useState } from 'react';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { taxDashboardApi } from '@/lib/tax-api';
import { formatMasaPajak } from '@/lib/tax-ui';
import { formatCurrency } from '@/lib/utils';
import type { DashboardPpnPoint } from '@/lib/tax-types';

/**
 * Widget 4 (MOD_tax_insurance §DASHBOARD WIDGETS): PPN periodic summary.
 * Shows per-Masa Pajak payment total alongside SPT filing state so the
 * Tax team can see at a glance which periods are closed vs. outstanding.
 */
export function PpnSummaryWidget({ months = 12 }: { months?: number }) {
    const [rows, setRows] = useState<DashboardPpnPoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        taxDashboardApi.ppnSummary(months)
            .then(setRows)
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, [months]);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">PPN Periodic Summary</h3>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No PPN records in the last {months} months.
                </p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {rows.map((r) => (
                        <li key={`${r.year}-${r.month}`}
                            className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="text-muted-foreground">
                                {formatMasaPajak(r.month, r.year)}
                            </span>
                            <span className="flex items-center gap-3">
                                <span className="tabular-nums">
                                    {formatCurrency(Number(r.total_paid) || 0, 'IDR')}
                                </span>
                                <StatusBadge
                                    status={r.spt_filed ? 'SPT filed' : 'Not filed'}
                                    variant={r.spt_filed ? 'success' : 'warning'}
                                />
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

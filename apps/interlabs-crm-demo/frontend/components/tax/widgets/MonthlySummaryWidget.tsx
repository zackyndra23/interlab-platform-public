'use client';

import { useEffect, useMemo, useState } from 'react';

import { taxDashboardApi } from '@/lib/tax-api';
import { formatMasaPajak } from '@/lib/tax-ui';
import { formatCurrency } from '@/lib/utils';
import type { DashboardMonthlyPoint, TaxType } from '@/lib/tax-types';

/**
 * Widgets 2 & 3 (MOD_tax_insurance §DASHBOARD WIDGETS): PPh 21 and PPh 25
 * monthly totals for the last 12 months. Rendered as a compact bar chart
 * using pure CSS — bars scale to the largest value in the series so the
 * relative trend is readable without a charting dep.
 */
export function MonthlySummaryWidget({
    taxType, months = 12,
}: {
    taxType: TaxType;
    months?: number;
}) {
    const [rows, setRows] = useState<DashboardMonthlyPoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        taxDashboardApi.monthlySummary(taxType, months)
            .then(setRows)
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, [taxType, months]);

    const max = useMemo(() => {
        if (rows.length === 0) return 0;
        return Math.max(
            ...rows.map((r) => Number(r.total_amount) || 0),
        );
    }, [rows]);

    const total = useMemo(() => {
        return rows.reduce((acc, r) => acc + (Number(r.total_amount) || 0), 0);
    }, [rows]);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{taxType} · Last {months} Months</h3>
                <span className="text-xs text-muted-foreground">
                    Total {formatCurrency(total, 'IDR')}
                </span>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No {taxType} records in the last {months} months.
                </p>
            ) : (
                <ul className="space-y-1">
                    {rows.map((r) => {
                        const amount = Number(r.total_amount) || 0;
                        const pct = max > 0 ? (amount / max) * 100 : 0;
                        return (
                            <li key={`${r.year}-${r.month}`}
                                className="grid grid-cols-[7rem_1fr_9rem] items-center gap-2 text-xs">
                                <span className="tabular-nums text-muted-foreground">
                                    {formatMasaPajak(r.month, r.year)}
                                </span>
                                <span className="relative block h-3 w-full rounded-sm bg-muted">
                                    <span
                                        className="absolute inset-y-0 left-0 rounded-sm bg-primary/70"
                                        style={{ width: `${pct}%` }}
                                    />
                                </span>
                                <span className="text-right tabular-nums">
                                    {formatCurrency(amount, 'IDR')}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

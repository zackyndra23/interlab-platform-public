'use client';

import { useEffect, useMemo, useState } from 'react';

import { operationalApi } from '@/lib/admin-log-api';
import { formatCurrency } from '@/lib/utils';
import type { Currency, OperationalRecord } from '@/lib/admin-log-types';

/**
 * Widget 5: Monthly Operational Summary.
 * Aggregates the current month's operational records by currency bucket
 * and per-category counts.
 */
export function MonthlyOperationalWidget() {
    const [rows, setRows] = useState<OperationalRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        operationalApi.list({ limit: 200 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const { totals, byCategory, month, year } = useMemo(() => {
        const now = new Date();
        const m = now.getUTCMonth() + 1;
        const y = now.getUTCFullYear();
        const thisMonth = rows.filter((r) => {
            if (!r.reporting_month) return false;
            const d = new Date(r.reporting_month);
            return d.getUTCMonth() + 1 === m && d.getUTCFullYear() === y;
        });
        const buckets: Partial<Record<Currency, number>> = {};
        const cats: Record<string, number> = {};
        for (const r of thisMonth) {
            const c = r.currency;
            buckets[c] = (buckets[c] || 0) + (r.amount || 0);
            const cat = r.expense_category || 'Uncategorised';
            cats[cat] = (cats[cat] || 0) + 1;
        }
        return { totals: buckets, byCategory: cats, month: m, year: y };
    }, [rows]);

    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', {
        month: 'long', year: 'numeric',
    });

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">
                Monthly Operational — {monthLabel}
            </h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <>
                    <div className="space-y-1 text-sm">
                        {Object.entries(totals).length === 0 && (
                            <p className="text-muted-foreground">No entries this month</p>
                        )}
                        {Object.entries(totals).map(([c, v]) => (
                            <div key={c} className="flex justify-between">
                                <span>{c}</span>
                                <span className="font-semibold">
                                    {formatCurrency(v || 0, c as Currency)}
                                </span>
                            </div>
                        ))}
                    </div>
                    {Object.keys(byCategory).length > 0 && (
                        <div className="mt-3 border-t border-border pt-2">
                            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                                By category
                            </p>
                            <ul className="space-y-0.5 text-xs">
                                {Object.entries(byCategory).map(([cat, n]) => (
                                    <li key={cat} className="flex justify-between">
                                        <span>{cat}</span>
                                        <span className="text-muted-foreground">{n}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

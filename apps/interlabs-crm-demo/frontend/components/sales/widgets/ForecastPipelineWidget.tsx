'use client';

import { useEffect, useState } from 'react';

import { forecastsApi } from '@/lib/sales-api';
import { formatCurrency } from '@/lib/utils';
import type { Currency, ForecastStage, SalesForecast } from '@/lib/sales-types';

/**
 * Widget 2: Sales Forecast Pipeline (MOD_sales §WIDGETS).
 *
 * Renders per-stage counts + a tiny horizontal bar showing the relative
 * estimated-value share per stage. No chart library — keeps the footprint
 * lean. Multi-currency values are summed by their own currency bucket
 * so we don't silently conflate IDR and USD.
 */

const STAGES: ForecastStage[] = [
    'Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost',
];

export function ForecastPipelineWidget() {
    const [rows, setRows] = useState<SalesForecast[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        forecastsApi.list({ limit: 200 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    // Aggregate per stage + per currency.
    const byStage: Record<ForecastStage, { count: number; value: Partial<Record<Currency, number>> }>
        = STAGES.reduce((acc, s) => {
            acc[s] = { count: 0, value: {} };
            return acc;
        }, {} as Record<ForecastStage, { count: number; value: Partial<Record<Currency, number>> }>);

    for (const r of rows) {
        const bucket = byStage[r.stage];
        if (!bucket) continue;
        bucket.count += 1;
        const currency = r.currency;
        bucket.value[currency] = (bucket.value[currency] || 0) + (r.estimated_value || 0);
    }

    const maxCount = Math.max(1, ...Object.values(byStage).map((b) => b.count));

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Forecast Pipeline</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <ul className="space-y-2">
                    {STAGES.map((s) => {
                        const bucket = byStage[s];
                        const width = `${(bucket.count / maxCount) * 100}%`;
                        const values = Object.entries(bucket.value)
                            .map(([c, v]) => formatCurrency(v || 0, c as Currency))
                            .join(' · ');
                        return (
                            <li key={s} className="text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">{s}</span>
                                    <span className="text-muted-foreground">
                                        {bucket.count} · {values || '—'}
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 w-full rounded bg-muted">
                                    <div
                                        className="h-1.5 rounded bg-primary/60"
                                        style={{ width }}
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

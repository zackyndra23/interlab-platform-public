'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import {
    forecastsApi, hppApi, purchaseRequestsApi,
    quotationsApi, salesPoApi,
} from '@/lib/sales-api';

/**
 * Widget 4: SLA Alert Banner. Pulls the first page of each form type
 * and surfaces anything with step_status='overdue'. Each row links to
 * the record's detail page so the user can open the overdue-reason
 * flow directly.
 */

type AlertRow = {
    id: string;
    record: string;
    form: string;
    href: string;
};

export function SlaAlertsWidget() {
    const [rows, setRows] = useState<AlertRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [fc, qt, hpp, po, pr] = await Promise.all([
                    forecastsApi.list({ limit: 100 }),
                    quotationsApi.list({ limit: 100 }),
                    hppApi.list({ limit: 100 }),
                    salesPoApi.list({ limit: 100 }),
                    purchaseRequestsApi.list({ limit: 100 }),
                ]);
                const out: AlertRow[] = [];
                for (const r of fc.rows) {
                    if (r.step_status === 'overdue') {
                        out.push({
                            id: r.id, record: r.forecast_record_number, form: 'Forecast',
                            href: `/sales/forecasts/${r.id}`,
                        });
                    }
                }
                for (const r of qt.rows) {
                    if (r.step_status === 'overdue') {
                        out.push({
                            id: r.id, record: r.quotation_record_number, form: 'Quotation',
                            href: `/sales/quotations/${r.id}`,
                        });
                    }
                }
                for (const r of hpp.rows) {
                    if (r.step_status === 'overdue') {
                        out.push({
                            id: r.id, record: r.hpp_record_number, form: 'HPP',
                            href: `/sales/hpp/${r.id}`,
                        });
                    }
                }
                for (const r of po.rows) {
                    if (r.step_status === 'overdue' || r.workflow_status === 'overdue') {
                        out.push({
                            id: r.id, record: r.po_record_number, form: 'PO',
                            href: `/sales/purchase-orders/${r.id}`,
                        });
                    }
                }
                for (const r of pr.rows) {
                    if (r.step_status === 'overdue') {
                        out.push({
                            id: r.id, record: r.pr_record_number, form: 'PR',
                            href: `/sales/purchase-requests/${r.id}`,
                        });
                    }
                }
                setRows(out);
            } catch {
                setRows([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={14} className="text-destructive" />
                SLA Alerts
            </h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing overdue</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {rows.map((r) => (
                        <li key={`${r.form}-${r.id}`} className="flex items-center justify-between">
                            <Link href={r.href} className="text-primary hover:underline">
                                {r.form} · {r.record}
                            </Link>
                            <span className="text-xs text-destructive">Overdue</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

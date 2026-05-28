'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Clock } from 'lucide-react';

import { salesPoApi } from '@/lib/sales-api';
import { formatDate } from '@/lib/utils';
import type { SalesPurchaseOrder } from '@/lib/sales-types';

/**
 * Widget 1: PO Pipeline Summary (MOD_sales §WIDGETS).
 *
 * Shows a count of POs by workflow_status, overdue count, and the next
 * PO to miss its SLA. Data is pulled from the Sales PO list endpoint
 * with `limit=100` — enough to cover any realistic active pipeline.
 * Swap to a dedicated `/api/dashboard/sales` endpoint when that ships
 * (IMPL_frontend §F7 line 374).
 */

export function PoPipelineWidget() {
    const [rows, setRows] = useState<SalesPurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        salesPoApi.list({ limit: 100 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.workflow_status] = (acc[r.workflow_status] || 0) + 1;
        return acc;
    }, {});
    const overdue = rows.filter((r) =>
        r.workflow_status === 'overdue' || r.step_status === 'overdue');
    const nextDue = rows
        .filter((r) => r.step_due_at)
        .sort((a, b) => (a.step_due_at! < b.step_due_at! ? -1 : 1))[0];

    return (
        <WidgetCard title="PO Pipeline" loading={loading}>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Stat label="Draft" value={counts.draft || 0} />
                <Stat label="Registered" value={counts.submitted || 0} />
                <Stat label="Processed" value={counts.processed || 0} />
                <Stat label="Overdue" value={overdue.length} danger />
            </div>
            <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {nextDue ? (
                    <div className="flex items-center gap-2">
                        <Clock size={12} />
                        Next due: <span className="font-medium text-foreground">{nextDue.po_record_number}</span>
                        {' · '}{formatDate(nextDue.step_due_at, { withTime: true })}
                    </div>
                ) : (
                    <span>No active deadlines</span>
                )}
                {overdue.length > 0 && (
                    <div className="mt-1 flex items-center gap-2 text-destructive">
                        <AlertCircle size={12} />
                        {overdue.length} PO(s) past SLA
                    </div>
                )}
            </div>
        </WidgetCard>
    );
}

function Stat({
    label, value, danger,
}: { label: string; value: number; danger?: boolean }) {
    return (
        <div>
            <p className={`text-2xl font-semibold ${danger ? 'text-destructive' : ''}`}>
                {value}
            </p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

function WidgetCard({
    title, loading, children,
}: {
    title: string;
    loading?: boolean;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">{title}</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : children}
        </section>
    );
}

'use client';

import { useEffect, useState } from 'react';

import { quotationsApi } from '@/lib/sales-api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { quotationVariant } from '@/lib/sales-ui';
import type { Quotation, QuotationWorkflow } from '@/lib/sales-types';

const WORKFLOWS: QuotationWorkflow[] = [
    'draft', 'submitted', 'revised', 'accepted', 'rejected',
];

export function QuotationStatusWidget() {
    const [rows, setRows] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        quotationsApi.list({ limit: 200 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.workflow_status] = (acc[r.workflow_status] || 0) + 1;
        return acc;
    }, {});

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Quotation Status</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="flex flex-wrap gap-3 text-sm">
                    {WORKFLOWS.map((w) => (
                        <div key={w} className="flex items-center gap-2">
                            <StatusBadge status={w} variant={quotationVariant(w)} />
                            <span className="font-semibold">{counts[w] || 0}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

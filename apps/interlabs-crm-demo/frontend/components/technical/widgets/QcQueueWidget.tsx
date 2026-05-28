'use client';

import { useEffect, useState } from 'react';

import { inspectionQcApi } from '@/lib/technical-api';
import type { InspectionQcRecord } from '@/lib/technical-types';

/**
 * Widget 4 (MOD_technical §WIDGETS): QC queue by review status.
 *
 * Split-counter so the team sees at a glance how many QC records are
 * waiting for reviewer attention vs. approved and ready to be submitted.
 */
export function QcQueueWidget() {
    const [rows, setRows] = useState<InspectionQcRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await inspectionQcApi.list({ limit: 200 });
                setRows(res.rows);
            } catch {
                setRows([]);
            } finally { setLoading(false); }
        })();
    }, []);

    const open = rows.filter((r) => r.final_submit_status === 'Draft');
    const pending = open.filter((r) => r.review_status === 'Pending Review').length;
    const reviewed = open.filter((r) => r.review_status === 'Reviewed').length;
    const approved = open.filter((r) => r.review_status === 'Approved').length;
    const submitted = rows.filter((r) => r.final_submit_status === 'Submitted').length;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">QC Queue</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <Stat label="Pending Review" value={pending} warn={pending > 0} />
                    <Stat label="Reviewed" value={reviewed} />
                    <Stat label="Approved" value={approved} />
                    <Stat label="Submitted" value={submitted} success={submitted > 0} />
                </div>
            )}
        </section>
    );
}

function Stat({
    label, value, warn, success,
}: { label: string; value: number; warn?: boolean; success?: boolean }) {
    return (
        <div>
            <p className={[
                'text-2xl font-semibold',
                warn ? 'text-amber-600 dark:text-amber-400' : '',
                success ? 'text-emerald-600 dark:text-emerald-400' : '',
            ].filter(Boolean).join(' ')}>
                {value}
            </p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

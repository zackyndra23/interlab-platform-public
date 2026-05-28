'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { readyToDeliverApi } from '@/lib/admin-log-api';
import { relativeTime } from '@/lib/utils';
import type { ReadyToDeliverEntry } from '@/lib/admin-log-types';

/**
 * Widget 4: Ready-to-Deliver Alerts.
 * Lists Technical installations/spareparts with
 * `admin_log_response_status = 'pending'`, sorted by the oldest
 * `ready_to_deliver_at` timestamp so items approaching the 2-day
 * SLA appear first.
 */
export function ReadyToDeliverAlertsWidget() {
    const [rows, setRows] = useState<ReadyToDeliverEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        readyToDeliverApi.list({
            admin_log_response_status: 'pending', limit: 100,
        })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const sorted = rows
        .slice()
        .sort((a, b) => {
            const ax = a.ready_to_deliver_at || '';
            const bx = b.ready_to_deliver_at || '';
            return ax < bx ? -1 : 1;
        })
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={14} className="text-destructive" />
                Ready-to-Deliver Alerts
            </h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing pending</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {sorted.map((r) => (
                        <li key={r.id} className="flex items-center justify-between">
                            <Link
                                href="/admin-log/ready-to-deliver"
                                className="text-primary hover:underline"
                            >
                                {r.technical_job_order_number || r.related_po_number || r.id.slice(0, 8)}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                                {relativeTime(r.ready_to_deliver_at)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

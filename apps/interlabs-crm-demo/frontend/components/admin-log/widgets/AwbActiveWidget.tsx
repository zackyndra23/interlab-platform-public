'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { awbApi } from '@/lib/admin-log-api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { awbStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type { AwbRecord } from '@/lib/admin-log-types';

/**
 * Widget 2: AWB Active Shipments.
 * Lists AWBs where `current_awb_status` is Registered or Processed,
 * sorted by despatch_date ascending (earliest-despatched first).
 */
export function AwbActiveWidget() {
    const [rows, setRows] = useState<AwbRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        awbApi.list({ limit: 100 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const active = rows
        .filter((r) => r.current_awb_status !== 'Arrived')
        .sort((a, b) => {
            const ad = a.despatch_date || '';
            const bd = b.despatch_date || '';
            return ad < bd ? -1 : 1;
        })
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">AWB Active Shipments</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : active.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active shipments</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {active.map((r) => (
                        <li key={r.id} className="flex items-center justify-between">
                            <div className="min-w-0">
                                <Link href={`/admin-log/awb/${r.id}`} className="text-primary hover:underline">
                                    {r.awb_record_number}
                                </Link>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    PO {r.related_po_number || '—'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(r.despatch_date) || '—'}
                                </span>
                                <StatusBadge
                                    status={r.current_awb_status}
                                    variant={awbStatusVariant(r.current_awb_status)}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

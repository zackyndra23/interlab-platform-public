'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { installationsApi, sparepartsApi } from '@/lib/technical-api';
import { workingDaysSince } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { InstallationRecord, SparepartRecord } from '@/lib/technical-types';

type Pending =
    | { kind: 'installation'; record: InstallationRecord }
    | { kind: 'sparepart'; record: SparepartRecord };

/**
 * Widget 3 (MOD_technical §WIDGETS): Ready-to-Deliver records awaiting
 * Admin & Log response. Combines Installation + Sparepart pending queues
 * and flags rows whose waiting time has exceeded the 2-working-day SLA.
 */
export function ReadyToDeliverPendingWidget() {
    const [rows, setRows] = useState<Pending[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [i, s] = await Promise.all([
                    installationsApi.list({
                        admin_log_response_status: 'pending', limit: 50,
                    }),
                    sparepartsApi.list({
                        admin_log_response_status: 'pending', limit: 50,
                    }),
                ]);
                setRows([
                    ...i.rows
                        .filter((r) => r.ready_to_deliver === 'Yes')
                        .map<Pending>((record) => ({ kind: 'installation', record })),
                    ...s.rows
                        .filter((r) => r.ready_to_deliver === 'Yes')
                        .map<Pending>((record) => ({ kind: 'sparepart', record })),
                ]);
            } catch {
                setRows([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Ready to Deliver · Pending Admin &amp; Log</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing pending.</p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {rows.slice(0, 8).map(({ kind, record }) => {
                        const days = workingDaysSince(record.ready_to_deliver_at);
                        const href = kind === 'installation'
                            ? `/technical/installations/${record.id}`
                            : `/technical/spareparts/${record.id}`;
                        return (
                            <li key={record.id} className="flex items-center justify-between px-3 py-2">
                                <Link href={href} className="truncate hover:underline">
                                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                        {kind}
                                    </span>
                                    <span className="ml-2 font-mono text-xs">
                                        {record.id.slice(0, 8)}…
                                    </span>
                                </Link>
                                <div className="flex items-center gap-3 text-xs">
                                    <span className="text-muted-foreground">
                                        {formatDate(record.ready_to_deliver_at) || '—'}
                                    </span>
                                    <span className={days > 2 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                                        {days}d
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

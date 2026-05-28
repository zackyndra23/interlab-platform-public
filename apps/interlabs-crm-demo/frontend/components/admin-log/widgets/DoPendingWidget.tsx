'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { deliveryOrdersApi } from '@/lib/admin-log-api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { doStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type { DeliveryOrder } from '@/lib/admin-log-types';

/**
 * Widget 3: Delivery Orders Pending — DOs awaiting customer arrival
 * confirmation (`current_do_status='Registered'`).
 */
export function DoPendingWidget() {
    const [rows, setRows] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        deliveryOrdersApi.list({ limit: 100 })
            .then((res) => setRows(res.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    const pending = rows
        .filter((r) => r.current_do_status === 'Registered')
        .slice(0, 8);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Delivery Orders Pending</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing pending</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {pending.map((r) => (
                        <li key={r.id} className="flex items-center justify-between">
                            <div className="min-w-0">
                                <Link href={`/admin-log/delivery-orders/${r.id}`} className="text-primary hover:underline">
                                    {r.do_record_number}
                                </Link>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    PO {r.related_po_number || '—'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(r.delivery_date) || '—'}
                                </span>
                                <StatusBadge
                                    status={r.current_do_status}
                                    variant={doStatusVariant(r.current_do_status)}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

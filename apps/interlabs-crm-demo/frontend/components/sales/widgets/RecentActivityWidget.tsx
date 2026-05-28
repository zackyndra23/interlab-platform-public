'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
    purchaseRequestsApi, quotationsApi, salesPoApi,
} from '@/lib/sales-api';
import { relativeTime } from '@/lib/utils';

/**
 * Widget 5: Recent Activity Feed. Merges the latest 5 POs, quotations,
 * and PRs by created_at. Uses list endpoints as the activity source
 * until a dedicated backend feed arrives — good enough for an
 * at-a-glance pulse without extra API surface.
 */

type Activity = {
    id: string;
    kind: 'PO' | 'Quotation' | 'PR';
    label: string;
    href: string;
    ts: string;
};

export function RecentActivityWidget() {
    const [items, setItems] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [pos, qts, prs] = await Promise.all([
                    salesPoApi.list({ limit: 5 }),
                    quotationsApi.list({ limit: 5 }),
                    purchaseRequestsApi.list({ limit: 5 }),
                ]);
                const merged: Activity[] = [
                    ...pos.rows.map((r) => ({
                        id: r.id, kind: 'PO' as const,
                        label: r.po_record_number,
                        href: `/sales/purchase-orders/${r.id}`,
                        ts: r.updated_at,
                    })),
                    ...qts.rows.map((r) => ({
                        id: r.id, kind: 'Quotation' as const,
                        label: r.quotation_record_number,
                        href: `/sales/quotations/${r.id}`,
                        ts: r.updated_at,
                    })),
                    ...prs.rows.map((r) => ({
                        id: r.id, kind: 'PR' as const,
                        label: r.pr_record_number,
                        href: `/sales/purchase-requests/${r.id}`,
                        ts: r.updated_at,
                    })),
                ].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 5);
                setItems(merged);
            } catch {
                setItems([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Recent Activity</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity</p>
            ) : (
                <ul className="space-y-1 text-sm">
                    {items.map((a) => (
                        <li key={`${a.kind}-${a.id}`} className="flex items-center justify-between">
                            <span>
                                <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {a.kind}
                                </span>
                                <Link href={a.href} className="text-primary hover:underline">
                                    {a.label}
                                </Link>
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {relativeTime(a.ts)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { taxDashboardApi } from '@/lib/tax-api';
import { auditActionVariant, taxCategoryVariant } from '@/lib/tax-ui';
import { relativeTime } from '@/lib/utils';
import type { DashboardRecentActivityRow } from '@/lib/tax-types';

/**
 * Widget 5 (MOD_tax_insurance §DASHBOARD WIDGETS): most recent audit-log
 * entries across all records — created, submitted, paid, verified.
 *
 * The backend returns the audit-log row id plus the denormalised
 * record_number, not the record_id, so rows aren't linked to a specific
 * detail page. A footer link drops the user into the full list.
 */
export function RecentTaxActivityWidget() {
    const [rows, setRows] = useState<DashboardRecentActivityRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        taxDashboardApi.recentActivity()
            .then(setRows)
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent Activity</h3>
                <Link href="/tax/operational" className="text-xs text-primary hover:underline">
                    Open list
                </Link>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {rows.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                            <StatusBadge
                                status={r.action}
                                variant={auditActionVariant(r.action)}
                            />
                            <div className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{r.tax_operational_record_number}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {r.tax_type}
                                </span>
                            </div>
                            <StatusBadge
                                status={r.tax_category}
                                variant={taxCategoryVariant(r.tax_category)}
                            />
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {relativeTime(r.created_at)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

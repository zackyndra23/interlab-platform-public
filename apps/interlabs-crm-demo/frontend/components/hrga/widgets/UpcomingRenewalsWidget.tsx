'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { complianceApi } from '@/lib/hrga-api';
import {
    complianceFlagLabel, complianceFlagVariant, daysUntil,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { ComplianceExpiringRow } from '@/lib/hrga-types';

/**
 * Widget 5 (MOD_hrga §DASHBOARD WIDGETS): upcoming renewals list.
 * Pulls /compliance/expiring?within_days=90 sorted by expiry ascending
 * so the soonest-due documents surface first.
 */
export function UpcomingRenewalsWidget() {
    const [rows, setRows] = useState<ComplianceExpiringRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        complianceApi.expiring({ limit: 8, within_days: 90 })
            .then((r) => setRows(r.rows))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Upcoming Renewals · Next 90 Days</h3>
                <Link href="/hrga/compliance" className="text-xs text-primary hover:underline">
                    Open Compliance
                </Link>
            </div>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No documents expiring in the next 90 days.
                </p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {rows.map((r) => {
                        const d = daysUntil(r.expiry_date);
                        return (
                            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                                <Link href={`/hrga/legalitas/${r.id}`}
                                    className="min-w-0 flex-1 truncate hover:underline">
                                    <span className="font-medium">{r.document_name}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {r.document_category || '—'} · exp {formatDate(r.expiry_date) || '—'}
                                    </span>
                                </Link>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {d === null ? '—' : d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`}
                                </span>
                                <StatusBadge
                                    status={complianceFlagLabel(r.compliance_flag)}
                                    variant={complianceFlagVariant(r.compliance_flag)}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

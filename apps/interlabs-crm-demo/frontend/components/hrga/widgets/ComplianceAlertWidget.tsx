'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';

import { complianceApi } from '@/lib/hrga-api';
import type { ComplianceSummary } from '@/lib/hrga-types';

/**
 * Widget 1 (MOD_hrga §DASHBOARD WIDGETS): tiered compliance counts.
 *
 * Expired is the most urgent tier; expiring≤30 is high; expiring≤90 is
 * moderate. Each count links into /hrga/compliance with the matching
 * flag filter so HRGA can drill in immediately.
 */
export function ComplianceAlertWidget() {
    const [sum, setSum] = useState<ComplianceSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        complianceApi.summary().then(setSum)
            .catch(() => setSum(null))
            .finally(() => setLoading(false));
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Compliance Alert Board</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid gap-3 md:grid-cols-4">
                    <Tile
                        title="Expired"
                        count={sum?.expired ?? 0}
                        icon={ShieldAlert}
                        tone="text-destructive"
                        href="/hrga/compliance"
                    />
                    <Tile
                        title="Expiring ≤30d"
                        count={sum?.expiring_soon_30 ?? 0}
                        icon={AlertTriangle}
                        tone="text-amber-600 dark:text-amber-400"
                        href="/hrga/compliance"
                    />
                    <Tile
                        title="Expiring ≤90d"
                        count={sum?.expiring_soon_90 ?? 0}
                        icon={AlertTriangle}
                        tone="text-primary"
                        href="/hrga/compliance"
                    />
                    <Tile
                        title="OK"
                        count={sum?.ok ?? 0}
                        icon={ShieldCheck}
                        tone="text-emerald-600 dark:text-emerald-400"
                        href="/hrga/compliance"
                    />
                </div>
            )}
        </section>
    );
}

function Tile({
    title, count, icon: Icon, tone, href,
}: {
    title: string;
    count: number;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    tone: string;
    href: string;
}) {
    return (
        <Link href={href}
            className="block rounded-md border border-border bg-background p-3 hover:bg-accent/40">
            <div className={`mb-1 inline-flex items-center gap-2 text-xs ${tone}`}>
                <Icon size={14} />
                {title}
            </div>
            <div className="text-xl font-semibold">{count}</div>
        </Link>
    );
}

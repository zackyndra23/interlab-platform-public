'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { taxDashboardApi } from '@/lib/tax-api';
import { formatMasaPajak } from '@/lib/tax-ui';
import type { DashboardMasaPajak, TaxType } from '@/lib/tax-types';

/**
 * Widget 1 (MOD_tax_insurance §DASHBOARD WIDGETS): current Masa Pajak
 * status board. Breaks down record counts by tax_type for the running
 * month, flags Unpaid / Draft backlogs, and warns on required tax types
 * (PPh 21, PPh 25, PPN) with zero records for the period.
 */
export function CurrentMasaPajakWidget() {
    const [data, setData] = useState<DashboardMasaPajak | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        taxDashboardApi.currentMasaPajak()
            .then(setData)
            .catch(() => setData(null))
            .finally(() => setLoading(false));
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                    Current Masa Pajak · {data ? formatMasaPajak(data.masa_pajak_month, data.masa_pajak_year) : '—'}
                </h3>
                <Link href="/tax/operational" className="text-xs text-primary hover:underline">
                    Open list
                </Link>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !data ? (
                <p className="text-sm text-muted-foreground">Could not load dashboard.</p>
            ) : (
                <>
                    {data.missing_required_tax_types.length > 0 && (
                        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                            <AlertCircle size={14} className="mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    Missing records for required tax types:
                                </p>
                                <p>{data.missing_required_tax_types.join(', ')}</p>
                            </div>
                        </div>
                    )}

                    {data.by_tax_type.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
                            <CheckCircle2 size={14} />
                            No records yet for the current Masa Pajak.
                        </div>
                    ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                            {data.by_tax_type.map((row) => (
                                <li key={row.tax_type}
                                    className="grid grid-cols-4 items-center gap-2 px-3 py-2 text-sm">
                                    <span className="font-medium">{row.tax_type as TaxType}</span>
                                    <Stat label="Records" value={row.total} />
                                    <Stat label="Unpaid" value={row.unpaid} emphasis={row.unpaid > 0} />
                                    <Stat label="Draft" value={row.draft} emphasis={row.draft > 0} />
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
    return (
        <div className="text-right">
            <p className={`text-sm tabular-nums ${emphasis ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}>
                {value}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        </div>
    );
}

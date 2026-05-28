'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlarmClock } from 'lucide-react';

import { jobOrdersApi } from '@/lib/technical-api';
import { formatDate } from '@/lib/utils';
import type { TechnicalJobOrder } from '@/lib/technical-types';

/**
 * Widget 1 (MOD_technical §WIDGETS): Active Job Orders with a 30-day PO
 * due-date reminder split by job_type. Pulled from the list endpoint with
 * due_date_reminder_flag=true; switch to /api/dashboard/technical when the
 * pre-aggregated endpoint ships (IMPL_frontend §F7).
 */
export function ActiveJobOrdersWidget() {
    const [active, setActive] = useState<TechnicalJobOrder[]>([]);
    const [reminders, setReminders] = useState<TechnicalJobOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [a, r] = await Promise.all([
                    jobOrdersApi.list({ workflow_status: 'active', limit: 200 }),
                    jobOrdersApi.list({ due_date_reminder_flag: true, limit: 25 }),
                ]);
                setActive(a.rows);
                setReminders(r.rows);
            } catch {
                setActive([]); setReminders([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const counts = active.reduce<Record<string, number>>((acc, j) => {
        acc[j.job_type] = (acc[j.job_type] || 0) + 1;
        return acc;
    }, {});

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Active Job Orders</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                        <Stat label="Installation" value={counts.Installation || 0} />
                        <Stat label="PM" value={counts.PM || 0} />
                        <Stat label="Sparepart" value={counts.Sparepart || 0} />
                    </div>

                    <div className="mt-4">
                        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                            <AlarmClock size={12} />
                            30-day PO due reminders ({reminders.length})
                        </p>
                        {reminders.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No reminders active.</p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border text-sm">
                                {reminders.slice(0, 5).map((j) => (
                                    <li key={j.id} className="flex items-center justify-between px-3 py-2">
                                        <Link href={`/technical/job-orders/${j.id}`} className="hover:underline">
                                            <span className="font-medium">{j.technical_job_order_number}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">{j.related_po_number}</span>
                                        </Link>
                                        <span className="text-xs text-muted-foreground">
                                            Due {formatDate(j.po_due_date) || '—'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

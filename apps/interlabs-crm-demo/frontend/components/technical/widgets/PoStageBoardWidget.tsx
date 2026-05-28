'use client';

import { useEffect, useState } from 'react';

import { installationsApi, bastApi } from '@/lib/technical-api';
import type { InstallationRecord, BastRecord } from '@/lib/technical-types';

/**
 * Widget 2 (MOD_technical §WIDGETS): PO Stage Status Board for the 3
 * stages Technical owns (Inspected / Installation / BAST).
 *
 * Computed from installation + BAST lists since those phases track the PO
 * transition directly; Inspected is derived from installation records that
 * passed inspection + function test. Swap to /api/dashboard/technical when
 * the pre-aggregated endpoint is available.
 */
export function PoStageBoardWidget() {
    const [installs, setInstalls] = useState<InstallationRecord[]>([]);
    const [basts, setBasts] = useState<BastRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [i, b] = await Promise.all([
                    installationsApi.list({ limit: 200 }),
                    bastApi.list({ limit: 200 }),
                ]);
                setInstalls(i.rows);
                setBasts(b.rows);
            } catch {
                setInstalls([]); setBasts([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const inspected = installs.filter((r) =>
        r.inspection_status === 'Complete' && r.function_test_status === 'Pass').length;
    const inInstallation = installs.filter((r) =>
        Boolean(r.installation_start_date) && r.workflow_phase !== 'completed').length;
    const overdueMilestones = installs.filter((r) =>
        r.installation_schedule_date
        && r.installation_schedule_date < new Date().toISOString().slice(0, 10)
        && !r.installation_start_date).length;
    const inBast = basts.filter((b) => b.workflow_status === 'sent_to_finance').length;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">PO Stage Board (Technical)</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <Stat label="Inspected" value={inspected} />
                    <Stat label="In Installation" value={inInstallation} />
                    <Stat label="BAST (sent)" value={inBast} />
                    <Stat label="Overdue Milestones" value={overdueMilestones}
                        danger={overdueMilestones > 0} />
                </div>
            )}
        </section>
    );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
    return (
        <div>
            <p className={`text-2xl font-semibold ${danger ? 'text-destructive' : ''}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

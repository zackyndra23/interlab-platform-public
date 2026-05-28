'use client';

import { useEffect, useState } from 'react';
import { Truck, FileText, ShoppingCart, AlarmClock } from 'lucide-react';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { awbApi } from '@/lib/admin-log-api';
import { awbStatusVariant } from '@/lib/admin-log-ui';
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import { prStatusVariant } from '@/lib/finance-ui';
import { formatDate } from '@/lib/utils';
import { isPoDueSoon } from '@/lib/technical-ui';
import type { UUID } from '@/lib/technical-types';

/**
 * Read-only cross-division surface per MOD_technical §INTER-DIVISION DATA
 * SURFACE. Shows the latest AWB, Finance PR, and (when the caller has them)
 * denormalized master-PO fields for a `related_po_id` so Technical users
 * don't navigate between modules.
 *
 * The PO panel is intentionally NOT fetched live: `related_po_id` is the
 * master `purchase_orders.id`, but the only exposed read endpoint is
 * `/api/sales/purchase-orders/:id` which keys off the Sales record id.
 * Those IDs differ (Sales submission creates a brand-new master PO row
 * via `poService.initializeFromSales`), so live lookups always miss.
 *
 * The Job Order row carries `related_po_number` and `po_due_date`
 * denormalized at create time — callers that have those pass them in and
 * the PO panel renders from those. Callers without denormalized PO
 * context (Installation, PM, Sparepart, QC, BAST) pass neither and the
 * panel is hidden rather than rendering misleading empty state.
 */

type CrossDivisionContextProps = {
    relatedPoId: UUID | null;
    poNumber?: string | null;
    poDueDate?: string | null;
};

export function CrossDivisionContext({
    relatedPoId, poNumber, poDueDate,
}: CrossDivisionContextProps) {
    const [awb, setAwb] = useState<{
        awb_record_number: string; current_awb_status: string;
        awb_tracking_number: string | null; arrival_date: string | null;
    } | null>(null);
    const [pr, setPr] = useState<{
        pr_record_number: string; current_pr_status: string;
        po_out_number: string | null; po_out_date: string | null;
    } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!relatedPoId) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [awbRes, prRes] = await Promise.all([
                    awbApi.list({ related_po_id: relatedPoId, limit: 1 }).catch(() => null),
                    // PR list doesn't accept related_po_id server-side (unknown:true
                    // swallows it); filter client-side on the most recent page.
                    purchaseRequisitionsApi.list({ limit: 50 }).catch(() => null),
                ]);
                if (cancelled) return;
                const latestAwb = awbRes?.rows?.[0];
                setAwb(latestAwb ? {
                    awb_record_number: latestAwb.awb_record_number,
                    current_awb_status: latestAwb.current_awb_status,
                    awb_tracking_number: latestAwb.awb_tracking_number,
                    arrival_date: latestAwb.arrival_date,
                } : null);
                const latestPr = prRes?.rows?.find((r) => r.related_po_id === relatedPoId);
                setPr(latestPr ? {
                    pr_record_number: latestPr.pr_record_number,
                    current_pr_status: latestPr.current_pr_status,
                    po_out_number: latestPr.po_out_number,
                    po_out_date: latestPr.po_out_date,
                } : null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [relatedPoId]);

    if (!relatedPoId) {
        return (
            <section className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                No related master PO — cross-division context unavailable.
            </section>
        );
    }

    const showPoPanel = Boolean(poNumber) || Boolean(poDueDate);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Cross-Division Context</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading context…</p>
            ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {showPoPanel && (
                        <Panel
                            icon={<ShoppingCart size={14} />}
                            title="Master PO"
                            subtitle={poNumber || '—'}
                        >
                            <Row label="Due" value={
                                <span className="inline-flex items-center gap-1">
                                    {formatDate(poDueDate || null) || '—'}
                                    {isPoDueSoon(poDueDate || null) && (
                                        <AlarmClock size={12} className="text-amber-500" />
                                    )}
                                </span>
                            } />
                        </Panel>
                    )}

                    <Panel
                        icon={<Truck size={14} />}
                        title="Latest AWB"
                        subtitle={awb?.awb_record_number || '—'}
                    >
                        {awb ? (
                            <>
                                <Row label="Status" value={
                                    <StatusBadge
                                        status={awb.current_awb_status}
                                        variant={awbStatusVariant(awb.current_awb_status as Parameters<typeof awbStatusVariant>[0])}
                                    />
                                } />
                                <Row label="Tracking" value={awb.awb_tracking_number || '—'} />
                                <Row label="Arrived" value={formatDate(awb.arrival_date) || '—'} />
                            </>
                        ) : <p className="text-xs text-muted-foreground">No AWB yet</p>}
                    </Panel>

                    <Panel
                        icon={<FileText size={14} />}
                        title="Finance PR"
                        subtitle={pr?.pr_record_number || '—'}
                    >
                        {pr ? (
                            <>
                                <Row label="PR Status" value={
                                    <StatusBadge
                                        status={pr.current_pr_status}
                                        variant={prStatusVariant(pr.current_pr_status as Parameters<typeof prStatusVariant>[0])}
                                    />
                                } />
                                <Row label="PO Out #" value={pr.po_out_number || '—'} />
                                <Row label="PO Out Date" value={formatDate(pr.po_out_date) || '—'} />
                            </>
                        ) : <p className="text-xs text-muted-foreground">No PR yet</p>}
                    </Panel>
                </div>
            )}
        </section>
    );
}

function Panel({
    icon, title, subtitle, children,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-md border border-border p-3">
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {icon}
                {title}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">{subtitle}</p>
            <div className="mt-2 space-y-1 text-xs">{children}</div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right">{value}</span>
        </div>
    );
}

'use client';

import {
    CheckCircle2, Circle, Clock,
} from 'lucide-react';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { ROLE_LABEL, type RoleKey } from '@/lib/rbac';
import { formatDate } from '@/lib/utils';
import type { PoStatusHistoryRow, PoTrackingStatus } from '@/lib/global-types';

/**
 * Vertical timeline of PO status history rows. The first row in `history`
 * is the most recent transition; each entry shows status label, actor,
 * role, timestamp, and any reason-if-delayed note.
 *
 * Used by the PO Tracking page for the latest-3 view (default) and the
 * full 11-stage view (Superadmin/CEO toggle).
 */
export function PoTrackingTimeline({
    history, currentStatus,
}: {
    history: PoStatusHistoryRow[];
    currentStatus?: PoTrackingStatus;
}) {
    if (history.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">No history yet.</p>
        );
    }

    return (
        <ol className="relative space-y-4 border-l border-border pl-5">
            {history.map((row) => {
                const isCurrent = currentStatus === row.status_label;
                const Icon = isCurrent ? Clock : CheckCircle2;
                return (
                    <li key={row.id} className="relative">
                        <span className="absolute -left-[27px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                            <Icon
                                size={12}
                                className={isCurrent
                                    ? 'text-primary'
                                    : 'text-emerald-600 dark:text-emerald-400'}
                            />
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                                status={row.status_label}
                                variant={isCurrent ? 'info' : 'success'}
                            />
                            {row.updated_by_role && (
                                <span className="text-xs text-muted-foreground">
                                    by {ROLE_LABEL[row.updated_by_role as RoleKey]
                                        ?? row.updated_by_role}
                                    {row.updated_by_name ? ` · ${row.updated_by_name}` : ''}
                                </span>
                            )}
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                                {formatDate(row.created_at, { withTime: true })}
                            </span>
                        </div>
                        {row.note && (
                            <p className="mt-1 text-sm text-foreground">{row.note}</p>
                        )}
                        {row.reason_if_delayed && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                Delay reason: {row.reason_if_delayed}
                            </p>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * Compact "all 11 stages" rail used when Superadmin/CEO clicks
 * "View Full History". Stages without a matching history row are dimmed
 * so the user can see at a glance which steps have not been reached.
 */
export const PO_STAGE_ORDER: PoTrackingStatus[] = [
    'Registered', 'Processed', 'Production', 'Shipped', 'Customs',
    'Arrived', 'Inspected', 'Delivery', 'Installation', 'BAST',
    'Invoice',
];

export function PoStageRail({
    history, currentStatus,
}: {
    history: PoStatusHistoryRow[];
    currentStatus: PoTrackingStatus;
}) {
    const reached = new Set(history.map((h) => h.status_label));
    const currentIndex = PO_STAGE_ORDER.indexOf(currentStatus);

    return (
        <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {PO_STAGE_ORDER.map((stage, idx) => {
                const isReached = reached.has(stage);
                const isCurrent = stage === currentStatus;
                const isFuture = idx > currentIndex;
                return (
                    <li
                        key={stage}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                            isCurrent
                                ? 'border-primary/50 bg-primary/10 text-primary'
                                : isReached
                                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                                    : isFuture
                                        ? 'border-border bg-background text-muted-foreground opacity-60'
                                        : 'border-border bg-background text-muted-foreground'
                        }`}
                    >
                        {isReached
                            ? <CheckCircle2 size={12} />
                            : <Circle size={12} />}
                        <span className="font-medium">{idx + 1}. {stage}</span>
                    </li>
                );
            })}
        </ol>
    );
}

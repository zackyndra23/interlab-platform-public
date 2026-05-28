'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { History, Search } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable } from '@/components/shared/DataTable';
import {
    PoStageRail, PoTrackingTimeline,
} from '@/components/global/PoTrackingTimeline';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { isGlobalRole } from '@/lib/rbac';
import { poTrackingApi } from '@/lib/global-api';
import { formatDate } from '@/lib/utils';
import type {
    PoStatusHistoryRow, PoStatusUpdatePush, PoTrackingRecord,
    PoTrackingSearchResult, PoTrackingStatus,
} from '@/lib/global-types';

/**
 * Global PO Tracking page (IMPL_frontend §F5).
 *
 * Two panels:
 * 1. Exact-search box: search by PO number → renders status + timeline.
 * 2. Browsable list: paginated table of all POs with search + status filter.
 *    Clicking a row loads full history into the drilldown panel below the
 *    table (who/when per stage).
 *
 * Subscribes to `po:status_update`; if the pushed po_id matches the
 * currently displayed PO (exact-search panel), the result reloads silently.
 */

const PO_STATUS_OPTIONS: PoTrackingStatus[] = [
    'Registered', 'Processed', 'Production', 'Shipped', 'Customs',
    'Arrived', 'Inspected', 'Delivery', 'Installation', 'BAST', 'Invoice',
];

function statusVariant(s: PoTrackingStatus | null | undefined):
    'info' | 'success' | 'warning' | 'muted' | 'neutral' {
    switch (s) {
        case 'Invoice':       return 'success';
        case 'BAST':          return 'success';
        case 'Installation':  return 'info';
        case 'Delivery':      return 'info';
        case 'Inspected':     return 'info';
        case 'Arrived':       return 'info';
        case 'Customs':       return 'warning';
        case 'Shipped':       return 'warning';
        case 'Production':    return 'warning';
        case 'Processed':     return 'neutral';
        case 'Registered':    return 'neutral';
        default:              return 'muted';
    }
}

/**
 * App Router requires `useSearchParams` consumers to sit beneath a
 * Suspense boundary so the route can prerender without bailing the whole
 * shell out. The default export wraps the actual page in Suspense.
 */
export default function PoTrackingPage() {
    return (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <PoTrackingPageInner />
        </Suspense>
    );
}

function PoTrackingPageInner() {
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const canViewFullHistory = !!user && isGlobalRole(user.role);

    // -----------------------------------------------------------------------
    // Exact-search panel (existing behavior)
    // -----------------------------------------------------------------------
    const [poNumber, setPoNumber] = useState('');
    const [result, setResult] = useState<PoTrackingSearchResult | null>(null);
    const [fullHistory, setFullHistory] = useState<PoStatusHistoryRow[] | null>(null);
    const [showFull, setShowFull] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    const runSearch = useCallback(async (po: string): Promise<void> => {
        const trimmed = po.trim();
        if (!trimmed) return;
        setLoading(true);
        setSearched(true);
        try {
            const res = await poTrackingApi.search(trimmed);
            setResult(res);
            setFullHistory(null);
            setShowFull(false);
        } catch (err) {
            setResult(null);
            const msg = err instanceof Error ? err.message : 'Search failed';
            if (/not.?found/i.test(msg)) {
                toast.message(`No PO found for "${trimmed}"`);
            } else {
                toast.error(msg);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    function onSubmit(e: React.FormEvent): void {
        e.preventDefault();
        runSearch(poNumber);
    }

    // Auto-run when arriving with /po-tracking?po=PO-... (PO Quick Search
    // dashboard widget pushes here). Only fires when the param value
    // actually changes so manual edits don't get overwritten.
    useEffect(() => {
        const fromQuery = searchParams?.get('po');
        if (!fromQuery) return;
        setPoNumber(fromQuery);
        runSearch(fromQuery);
    }, [searchParams, runSearch]);

    async function loadFullHistory(): Promise<void> {
        if (!result) return;
        if (fullHistory) {
            setShowFull((v) => !v);
            return;
        }
        try {
            const rows = await poTrackingApi.fullHistory(result.po.id);
            setFullHistory(rows);
            setShowFull(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not load history');
        }
    }

    // Realtime: when any PO advances and it matches our current view,
    // re-pull the search result so the latest-3 reflects the new stage.
    useWebSocket<PoStatusUpdatePush>('po:status_update', (push) => {
        if (!result) return;
        if (push.po_id !== result.po.id) return;
        runSearch(result.po.po_number);
    });

    // -----------------------------------------------------------------------
    // Browsable list panel (new)
    // -----------------------------------------------------------------------
    const [listRows, setListRows] = useState<PoTrackingRecord[]>([]);
    const [listMeta, setListMeta] = useState<{ total: number }>({ total: 0 });
    const [listPage, setListPage] = useState(1);
    const [listLimit, setListLimit] = useState(25);
    const [listSearch, setListSearch] = useState('');
    const [listStatus, setListStatus] = useState('');
    const [listLoading, setListLoading] = useState(true);

    // Debounce list search → server (250 ms).
    const [debouncedListSearch, setDebouncedListSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedListSearch(listSearch), 250);
        return () => clearTimeout(h);
    }, [listSearch]);

    // Selected PO for drilldown (from list row click).
    const [selectedPo, setSelectedPo] = useState<PoTrackingRecord | null>(null);
    const [drilldownHistory, setDrilldownHistory] = useState<PoStatusHistoryRow[] | null>(null);
    const [drilldownLoading, setDrilldownLoading] = useState(false);

    async function reloadList(): Promise<void> {
        setListLoading(true);
        try {
            const res = await poTrackingApi.list({
                page: listPage,
                limit: listLimit,
                search: debouncedListSearch || undefined,
                status: listStatus || undefined,
            });
            setListRows(res.rows);
            setListMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load PO list');
        } finally {
            setListLoading(false);
        }
    }

    useEffect(() => {
        reloadList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listPage, listLimit, debouncedListSearch, listStatus]);

    async function handleRowClick(po: PoTrackingRecord): Promise<void> {
        setSelectedPo(po);
        setDrilldownHistory(null);
        setDrilldownLoading(true);
        try {
            const rows = await poTrackingApi.fullHistory(po.id);
            setDrilldownHistory(rows);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not load history');
        } finally {
            setDrilldownLoading(false);
        }
    }

    const listColumns = useMemo<ColumnDef<PoTrackingRecord>[]>(() => [
        {
            header: 'PO Number',
            accessorKey: 'po_number',
            cell: ({ row }) => (
                <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => handleRowClick(row.original)}
                >
                    {row.original.po_number}
                </button>
            ),
        },
        {
            header: 'Customer',
            accessorKey: 'customer_name',
            cell: ({ getValue }) => (getValue() as string | null) ?? '—',
        },
        {
            header: 'Status',
            accessorKey: 'current_status',
            cell: ({ getValue }) => {
                const s = getValue() as PoTrackingStatus;
                return <StatusBadge status={s} variant={statusVariant(s)} />;
            },
        },
        {
            header: 'Updated',
            accessorKey: 'updated_at',
            cell: ({ getValue }) => formatDate(getValue() as string, { withTime: true }),
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], []);

    const statusFilterBar = (
        <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="po-status-filter">
                Status
            </label>
            <select
                id="po-status-filter"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={listStatus}
                onChange={(e) => { setListStatus(e.target.value); setListPage(1); }}
            >
                <option value="">All</option>
                {PO_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                ))}
            </select>
        </div>
    );

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold">PO Tracking</h2>
                <p className="text-xs text-muted-foreground">
                    Look up any Purchase Order by number, or browse the full list below.
                </p>
            </div>

            {/* ---- Exact-search panel ---- */}
            <section className="space-y-4">
                <form onSubmit={onSubmit} className="flex max-w-xl items-center gap-2">
                    <div className="relative flex-1">
                        <Search
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            value={poNumber}
                            onChange={(e) => setPoNumber(e.target.value)}
                            placeholder="Enter PO number (e.g. PO-2025-00042)"
                            className="pl-8"
                        />
                    </div>
                    <Button type="submit" size="sm" disabled={loading || !poNumber.trim()}>
                        {loading ? 'Searching…' : 'Search'}
                    </Button>
                </form>

                {loading && (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                )}

                {!loading && searched && !result && (
                    <p className="text-sm text-muted-foreground">
                        No PO found. Verify the number, or try a partial — search is exact-match by PO number.
                    </p>
                )}

                {result && (
                    <section className="space-y-4 rounded-md border border-border bg-card p-4">
                        <header className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold">{result.po.po_number}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {result.po.customer_name || 'Customer not set'}
                                    {result.po.due_at
                                        ? ` · due ${formatDate(result.po.due_at)}`
                                        : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge
                                    status={result.po.current_status}
                                    variant={statusVariant(result.po.current_status)}
                                />
                                {result.po.overdue_at && (
                                    <StatusBadge status="Overdue" variant="danger" />
                                )}
                            </div>
                        </header>

                        {result.po.overdue_reason && (
                            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                                Overdue reason: {result.po.overdue_reason}
                            </p>
                        )}

                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    {showFull ? 'Full History · 11 stages' : 'Latest 3 movements'}
                                </p>
                                {canViewFullHistory && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={loadFullHistory}
                                    >
                                        <History size={14} />
                                        {showFull ? 'Latest 3' : 'View Full History'}
                                    </Button>
                                )}
                            </div>

                            {showFull && fullHistory ? (
                                <div className="space-y-4">
                                    <PoStageRail
                                        history={fullHistory}
                                        currentStatus={result.po.current_status}
                                    />
                                    <PoTrackingTimeline
                                        history={fullHistory}
                                        currentStatus={result.po.current_status}
                                    />
                                </div>
                            ) : (
                                <PoTrackingTimeline
                                    history={result.history}
                                    currentStatus={result.po.current_status}
                                />
                            )}
                        </div>
                    </section>
                )}
            </section>

            {/* ---- Browsable list panel ---- */}
            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    All Purchase Orders
                </h3>

                <DataTable<PoTrackingRecord>
                    columns={listColumns}
                    data={listRows}
                    loading={listLoading}
                    page={listPage}
                    limit={listLimit}
                    total={listMeta.total}
                    onPageChange={setListPage}
                    onLimitChange={(l) => { setListLimit(l); setListPage(1); }}
                    searchValue={listSearch}
                    onSearch={(v) => { setListSearch(v); setListPage(1); }}
                    searchPlaceholder="Search PO number / customer…"
                    filterBar={statusFilterBar}
                    emptyMessage="No purchase orders found."
                />
            </section>

            {/* ---- Drilldown: full timeline for selected PO from list ---- */}
            {selectedPo && (
                <section className="space-y-4 rounded-md border border-border bg-card p-4">
                    <header className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-base font-semibold">{selectedPo.po_number}</h3>
                            <p className="text-xs text-muted-foreground">
                                {selectedPo.customer_name || 'Customer not set'}
                                {selectedPo.due_at
                                    ? ` · due ${formatDate(selectedPo.due_at)}`
                                    : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusBadge
                                status={selectedPo.current_status}
                                variant={statusVariant(selectedPo.current_status)}
                            />
                            {selectedPo.overdue_at && (
                                <StatusBadge status="Overdue" variant="danger" />
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => { setSelectedPo(null); setDrilldownHistory(null); }}
                            >
                                Close
                            </Button>
                        </div>
                    </header>

                    {selectedPo.overdue_reason && (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                            Overdue reason: {selectedPo.overdue_reason}
                        </p>
                    )}

                    {drilldownLoading && (
                        <p className="text-sm text-muted-foreground">Loading history…</p>
                    )}

                    {!drilldownLoading && drilldownHistory && (
                        <div className="space-y-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Full History · 11 stages
                            </p>
                            <PoStageRail
                                history={drilldownHistory}
                                currentStatus={selectedPo.current_status}
                            />
                            <PoTrackingTimeline
                                history={drilldownHistory}
                                currentStatus={selectedPo.current_status}
                            />
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

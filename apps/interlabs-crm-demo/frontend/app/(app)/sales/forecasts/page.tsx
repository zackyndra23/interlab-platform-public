'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { forecastsApi } from '@/lib/sales-api';
import { forecastWorkflowVariant, forecastStageVariant, slaVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { SalesForecast } from '@/lib/sales-types';

export default function ForecastsListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<SalesForecast[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<SalesForecast | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await forecastsApi.list({
                page, limit, search: debouncedSearch || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }

    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch]);

    const columns = useMemo<ColumnDef<SalesForecast>[]>(() => [
        { header: 'Record #', accessorKey: 'forecast_record_number' },
        { header: 'Product / Service', accessorKey: 'product_or_service_name' },
        {
            header: 'Stage', accessorKey: 'stage',
            cell: ({ getValue }) => {
                const s = getValue() as SalesForecast['stage'];
                return <StatusBadge status={s} variant={forecastStageVariant(s)} />;
            },
        },
        {
            header: 'Workflow', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as SalesForecast['workflow_status'];
                return <StatusBadge status={s} variant={forecastWorkflowVariant(s)} />;
            },
        },
        {
            header: 'Value', accessorKey: 'estimated_value',
            cell: ({ row }) => formatCurrency(row.original.estimated_value, row.original.currency),
        },
        {
            header: 'Probability',
            accessorKey: 'probability_percent',
            cell: ({ getValue }) => {
                const v = getValue() as number | null;
                return v === null ? '—' : `${v}%`;
            },
        },
        {
            header: 'Close', accessorKey: 'expected_close_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'SLA', accessorKey: 'step_status',
            cell: ({ getValue }) => {
                const s = getValue() as SalesForecast['step_status'];
                return <StatusBadge status={s} variant={slaVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/sales/forecasts/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/sales/forecasts/${row.original.id}/edit`)} />
                    <IconButton
                        icon={Send}
                        tooltip="Submit"
                        variant="primary"
                        disabled={row.original.workflow_status !== 'draft'}
                        onClick={async () => {
                            try {
                                await forecastsApi.submit(row.original.id);
                                toast.success('Forecast submitted');
                                reload();
                            } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Submit failed');
                            }
                        }}
                    />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await forecastsApi.remove(confirmDelete.id);
            toast.success('Forecast deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Sales Forecasts</h2>
                <Button size="sm" onClick={() => router.push('/sales/forecasts/new')}>
                    <Plus size={14} />
                    New Forecast
                </Button>
            </div>

            <DataTable<SalesForecast>
                columns={columns}
                data={rows}
                loading={loading}
                page={page}
                limit={limit}
                total={meta.total}
                onPageChange={setPage}
                onLimitChange={(l) => { setLimit(l); setPage(1); }}
                searchValue={search}
                onSearch={setSearch}
                searchPlaceholder="Search forecast / product…"
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete forecast?"
                message={`This will soft-delete ${confirmDelete?.forecast_record_number || 'the forecast'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

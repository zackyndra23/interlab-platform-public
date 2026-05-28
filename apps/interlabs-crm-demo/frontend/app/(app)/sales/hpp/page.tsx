'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { hppApi } from '@/lib/sales-api';
import { hppVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { HargaPokokPenjualan } from '@/lib/sales-types';

export default function HppListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<HargaPokokPenjualan[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<HargaPokokPenjualan | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await hppApi.list({
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

    const columns = useMemo<ColumnDef<HargaPokokPenjualan>[]>(() => [
        { header: 'Record #', accessorKey: 'hpp_record_number' },
        {
            header: 'Date', accessorKey: 'hpp_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Total Cost', accessorKey: 'total_cost',
            cell: ({ row }) => formatCurrency(row.original.total_cost, row.original.currency),
        },
        {
            header: 'Total Selling', accessorKey: 'total_selling_price',
            cell: ({ row }) => formatCurrency(row.original.total_selling_price, row.original.currency),
        },
        {
            header: 'Margin', accessorKey: 'gross_margin_total',
            cell: ({ row }) => formatCurrency(row.original.gross_margin_total, row.original.currency),
        },
        {
            header: 'Status', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as HargaPokokPenjualan['workflow_status'];
                return <StatusBadge status={s} variant={hppVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/sales/hpp/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/sales/hpp/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await hppApi.remove(confirmDelete.id);
            toast.success('HPP deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Harga Pokok Penjualan</h2>
                <Button size="sm" onClick={() => router.push('/sales/hpp/new')}>
                    <Plus size={14} />
                    New HPP
                </Button>
            </div>
            <DataTable<HargaPokokPenjualan>
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
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete HPP?"
                message={`This will soft-delete ${confirmDelete?.hpp_record_number || 'the HPP'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

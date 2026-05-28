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
import { deliveryOrdersApi } from '@/lib/admin-log-api';
import { doStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type { DeliveryOrder } from '@/lib/admin-log-types';

export default function DeliveryOrdersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<DeliveryOrder[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<DeliveryOrder | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await deliveryOrdersApi.list({ page, limit, search: debouncedSearch || undefined });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch]);

    const columns = useMemo<ColumnDef<DeliveryOrder>[]>(() => [
        { header: 'Record #', accessorKey: 'do_record_number' },
        { header: 'DO #', accessorKey: 'delivery_order_number' },
        { header: 'PO #', accessorKey: 'related_po_number' },
        {
            header: 'Delivery Date', accessorKey: 'delivery_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Customer Arrival', accessorKey: 'customer_arrival_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Status', accessorKey: 'current_do_status',
            cell: ({ getValue }) => {
                const s = getValue() as DeliveryOrder['current_do_status'];
                return <StatusBadge status={s} variant={doStatusVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/admin-log/delivery-orders/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/admin-log/delivery-orders/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await deliveryOrdersApi.remove(confirmDelete.id);
            toast.success('Delivery order deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Delivery Orders</h2>
                <Button size="sm" onClick={() => router.push('/admin-log/delivery-orders/new')}>
                    <Plus size={14} />
                    New DO
                </Button>
            </div>
            <DataTable<DeliveryOrder>
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
                searchPlaceholder="Search DO / PO…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete DO?"
                message={`This will soft-delete ${confirmDelete?.do_record_number || 'the DO'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

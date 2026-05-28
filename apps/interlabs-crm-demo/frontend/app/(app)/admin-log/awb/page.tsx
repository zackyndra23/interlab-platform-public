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
import { awbApi } from '@/lib/admin-log-api';
import { awbStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type { AwbRecord } from '@/lib/admin-log-types';

export default function AwbListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<AwbRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<AwbRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await awbApi.list({ page, limit, search: debouncedSearch || undefined });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch]);

    const columns = useMemo<ColumnDef<AwbRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'awb_record_number' },
        { header: 'PO #', accessorKey: 'related_po_number' },
        { header: 'Tracking #', accessorKey: 'awb_tracking_number' },
        { header: 'Forwarder', accessorKey: 'forwarder_or_courier' },
        {
            header: 'Despatch', accessorKey: 'despatch_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Arrival', accessorKey: 'arrival_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Status', accessorKey: 'current_awb_status',
            cell: ({ getValue }) => {
                const s = getValue() as AwbRecord['current_awb_status'];
                return <StatusBadge status={s} variant={awbStatusVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/admin-log/awb/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/admin-log/awb/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await awbApi.remove(confirmDelete.id);
            toast.success('AWB deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Airway Bill List</h2>
                <Button size="sm" onClick={() => router.push('/admin-log/awb/new')}>
                    <Plus size={14} />
                    New AWB
                </Button>
            </div>
            <DataTable<AwbRecord>
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
                searchPlaceholder="Search AWB / PO / tracking…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete AWB?"
                message={`This will soft-delete ${confirmDelete?.awb_record_number || 'the AWB'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

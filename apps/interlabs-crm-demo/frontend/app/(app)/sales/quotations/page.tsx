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
import { quotationsApi } from '@/lib/sales-api';
import { quotationVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Quotation } from '@/lib/sales-types';

export default function QuotationsListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<Quotation[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<Quotation | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await quotationsApi.list({
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

    const columns = useMemo<ColumnDef<Quotation>[]>(() => [
        { header: 'Record #', accessorKey: 'quotation_record_number' },
        { header: 'Quotation #', accessorKey: 'quotation_number' },
        {
            header: 'Date', accessorKey: 'quotation_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Validity', accessorKey: 'validity_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Total', accessorKey: 'total_amount',
            cell: ({ row }) => formatCurrency(row.original.total_amount, row.original.currency),
        },
        {
            header: 'Status', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as Quotation['workflow_status'];
                return <StatusBadge status={s} variant={quotationVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/sales/quotations/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/sales/quotations/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await quotationsApi.remove(confirmDelete.id);
            toast.success('Quotation deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Quotations</h2>
                <Button size="sm" onClick={() => router.push('/sales/quotations/new')}>
                    <Plus size={14} />
                    New Quotation
                </Button>
            </div>
            <DataTable<Quotation>
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
                title="Delete quotation?"
                message={`This will soft-delete ${confirmDelete?.quotation_record_number || 'the quotation'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

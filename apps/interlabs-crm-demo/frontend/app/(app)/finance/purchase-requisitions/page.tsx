'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import { prStatusVariant } from '@/lib/finance-ui';
import { formatDate } from '@/lib/utils';
import type { PurchaseRequisition } from '@/lib/finance-types';

export default function PurchaseRequisitionsListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<PurchaseRequisition[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<PurchaseRequisition | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await purchaseRequisitionsApi.list({
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

    const columns = useMemo<ColumnDef<PurchaseRequisition>[]>(() => [
        { header: 'Record #', accessorKey: 'pr_record_number' },
        { header: 'PR Number', accessorKey: 'pr_number' },
        { header: 'Supplier', accessorKey: 'supplier_or_manufacturer' },
        { header: 'PO Out #', accessorKey: 'po_out_number' },
        {
            header: 'PO Out Date', accessorKey: 'po_out_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Status', accessorKey: 'current_pr_status',
            cell: ({ getValue }) => {
                const s = getValue() as PurchaseRequisition['current_pr_status'];
                return <StatusBadge status={s} variant={prStatusVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/finance/purchase-requisitions/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/finance/purchase-requisitions/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await purchaseRequisitionsApi.remove(confirmDelete.id);
            toast.success('PR deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Purchase Requisitions</h2>
                <p className="text-xs text-muted-foreground">
                    Auto-created by Sales on PR submission.
                </p>
            </div>
            <DataTable<PurchaseRequisition>
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
                searchPlaceholder="Search PR / supplier…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete PR?"
                message={`This will soft-delete ${confirmDelete?.pr_record_number || 'the record'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

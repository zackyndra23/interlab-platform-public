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
import { purchaseRequestsApi } from '@/lib/sales-api';
import { prVariant } from '@/lib/sales-ui';
import { formatDate } from '@/lib/utils';
import type { PurchaseRequestSales } from '@/lib/sales-types';

export default function PurchaseRequestsListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<PurchaseRequestSales[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<PurchaseRequestSales | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await purchaseRequestsApi.list({
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

    const columns = useMemo<ColumnDef<PurchaseRequestSales>[]>(() => [
        { header: 'Record #', accessorKey: 'pr_record_number' },
        { header: 'Supplier', accessorKey: 'supplier_or_manufacturer' },
        { header: 'Incoterm', accessorKey: 'incoterm' },
        {
            header: 'PR Date', accessorKey: 'pr_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Status', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as PurchaseRequestSales['workflow_status'];
                return <StatusBadge status={s} variant={prVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/sales/purchase-requests/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/sales/purchase-requests/${row.original.id}/edit`)} />
                    <IconButton
                        icon={Send}
                        tooltip="Submit"
                        variant="primary"
                        disabled={row.original.workflow_status !== 'draft'}
                        onClick={async () => {
                            try {
                                await purchaseRequestsApi.submit(row.original.id);
                                toast.success('PR submitted to Finance');
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
            await purchaseRequestsApi.remove(confirmDelete.id);
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
                <h2 className="text-lg font-semibold">Purchase Requests</h2>
                <Button size="sm" onClick={() => router.push('/sales/purchase-requests/new')}>
                    <Plus size={14} />
                    New PR
                </Button>
            </div>
            <DataTable<PurchaseRequestSales>
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
                title="Delete PR?"
                message={`This will soft-delete ${confirmDelete?.pr_record_number || 'the PR'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

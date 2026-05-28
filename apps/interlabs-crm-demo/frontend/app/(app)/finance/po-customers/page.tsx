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
import { poCustomersApi } from '@/lib/finance-api';
import { poCustomerWorkflowVariant } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { PoCustomer } from '@/lib/finance-types';

/**
 * PO Customer list. No "New" button — rows are auto-created by Sales
 * on PO submission.
 */
export default function PoCustomersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<PoCustomer[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<PoCustomer | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await poCustomersApi.list({
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

    const columns = useMemo<ColumnDef<PoCustomer>[]>(() => [
        { header: 'Record #', accessorKey: 'po_customer_record_number' },
        { header: 'Customer PO #', accessorKey: 'po_customer_number' },
        { header: 'Version', accessorKey: 'version' },
        {
            header: 'Order Date', accessorKey: 'order_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Total', accessorKey: 'total_amount',
            cell: ({ row }) => formatCurrency(row.original.total_amount, row.original.currency),
        },
        { header: 'PO Stage', accessorKey: 'current_po_status' },
        {
            header: 'Workflow', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as PoCustomer['workflow_status'];
                return <StatusBadge status={s} variant={poCustomerWorkflowVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/finance/po-customers/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/finance/po-customers/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await poCustomersApi.remove(confirmDelete.id);
            toast.success('PO Customer deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">PO Customer</h2>
                <p className="text-xs text-muted-foreground">
                    Auto-created by Sales on PO submission.
                </p>
            </div>
            <DataTable<PoCustomer>
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
                searchPlaceholder="Search PO customer / number…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete PO Customer?"
                message={`This will soft-delete ${confirmDelete?.po_customer_record_number || 'the record'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

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
import { customersApi } from '@/lib/sales-api';
import { customerVariant } from '@/lib/sales-ui';
import { formatDate } from '@/lib/utils';
import type { Customer } from '@/lib/sales-types';

/**
 * Customer list. DataTable with server pagination. Search debounced at
 * the page level (250 ms) so each keystroke doesn't hit the server.
 */
export default function CustomersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<Customer[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

    // Debounce search → server.
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await customersApi.list({
                page, limit, search: debouncedSearch || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch]);

    const columns = useMemo<ColumnDef<Customer>[]>(() => [
        { header: 'Record #', accessorKey: 'customer_record_number' },
        { header: 'Company', accessorKey: 'company_name' },
        { header: 'PIC', accessorKey: 'pic_name' },
        { header: 'Phone', accessorKey: 'phone' },
        { header: 'Email', accessorKey: 'email' },
        {
            header: 'Status', accessorKey: 'customer_status',
            cell: ({ getValue }) => {
                const s = getValue() as Customer['customer_status'];
                return <StatusBadge status={s} variant={customerVariant(s)} />;
            },
        },
        {
            header: 'Created', accessorKey: 'created_at',
            cell: ({ getValue }) => formatDate(getValue() as string, { withTime: true }),
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton
                        icon={Eye}
                        tooltip="View"
                        onClick={() => router.push(`/sales/customers/${row.original.id}`)}
                    />
                    <IconButton
                        icon={Pencil}
                        tooltip="Edit"
                        onClick={() => router.push(`/sales/customers/${row.original.id}/edit`)}
                    />
                    <IconButton
                        icon={Trash2}
                        tooltip="Delete"
                        variant="danger"
                        onClick={() => setConfirmDelete(row.original)}
                    />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await customersApi.remove(confirmDelete.id);
            toast.success('Customer deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Customers</h2>
                <Button size="sm" onClick={() => router.push('/sales/customers/new')}>
                    <Plus size={14} />
                    New Customer
                </Button>
            </div>

            <DataTable<Customer>
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
                searchPlaceholder="Search company / PIC…"
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete customer?"
                message={`This will soft-delete ${confirmDelete?.company_name || 'the customer'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

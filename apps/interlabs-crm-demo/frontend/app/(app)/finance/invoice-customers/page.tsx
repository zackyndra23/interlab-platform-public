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
import { invoiceCustomersApi } from '@/lib/finance-api';
import { invoiceCustomerStatusVariant } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceCustomer } from '@/lib/finance-types';

export default function InvoiceCustomersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<InvoiceCustomer[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<InvoiceCustomer | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await invoiceCustomersApi.list({
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

    const columns = useMemo<ColumnDef<InvoiceCustomer>[]>(() => [
        { header: 'Record #', accessorKey: 'invoice_customer_record_number' },
        { header: 'Invoice #', accessorKey: 'invoice_number' },
        {
            header: 'Invoice Date', accessorKey: 'invoice_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Due', accessorKey: 'payment_due_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Total', accessorKey: 'total_amount',
            cell: ({ row }) => formatCurrency(row.original.total_amount, row.original.currency),
        },
        {
            header: 'Status', accessorKey: 'invoice_status',
            cell: ({ getValue }) => {
                const s = getValue() as InvoiceCustomer['invoice_status'];
                return <StatusBadge status={s} variant={invoiceCustomerStatusVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/finance/invoice-customers/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/finance/invoice-customers/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await invoiceCustomersApi.remove(confirmDelete.id);
            toast.success('Invoice deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Invoice Customer</h2>
                <p className="text-xs text-muted-foreground">
                    Drafts auto-created by Technical BAST upload.
                </p>
            </div>
            <DataTable<InvoiceCustomer>
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
                searchPlaceholder="Search invoice / customer…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete invoice?"
                message={`This will soft-delete ${confirmDelete?.invoice_customer_record_number || 'the record'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Send, CheckCircle2, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { operationalApi } from '@/lib/admin-log-api';
import {
    expenseStatusVariant, operationalWorkflowVariant,
} from '@/lib/admin-log-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { OperationalRecord } from '@/lib/admin-log-types';

export default function OperationalListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<OperationalRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<OperationalRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await operationalApi.list({ page, limit, search: debouncedSearch || undefined });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch]);

    const columns = useMemo<ColumnDef<OperationalRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'operational_record_number' },
        {
            header: 'Reporting Month', accessorKey: 'reporting_month',
            cell: ({ getValue }) => formatDate(getValue() as string)?.slice(0, 7) || '—',
        },
        { header: 'Category', accessorKey: 'expense_category' },
        { header: 'Vendor / Payee', accessorKey: 'vendor_or_payee' },
        {
            header: 'Amount', accessorKey: 'amount',
            cell: ({ row }) => formatCurrency(row.original.amount, row.original.currency),
        },
        {
            header: 'Payment', accessorKey: 'expense_status',
            cell: ({ getValue }) => {
                const s = getValue() as OperationalRecord['expense_status'];
                return <StatusBadge status={s} variant={expenseStatusVariant(s)} />;
            },
        },
        {
            header: 'Workflow', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as OperationalRecord['workflow_status'];
                return <StatusBadge status={s} variant={operationalWorkflowVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/admin-log/operational/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/admin-log/operational/${row.original.id}/edit`)} />
                    <IconButton
                        icon={Send}
                        tooltip="Submit"
                        variant="primary"
                        disabled={row.original.workflow_status !== 'draft'}
                        onClick={async () => {
                            try {
                                await operationalApi.transition(row.original.id, 'submitted');
                                toast.success('Record submitted');
                                reload();
                            } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Submit failed');
                            }
                        }}
                    />
                    <IconButton
                        icon={CheckCircle2}
                        tooltip="Mark Reviewed"
                        variant="primary"
                        disabled={row.original.workflow_status !== 'submitted'}
                        onClick={async () => {
                            try {
                                await operationalApi.transition(row.original.id, 'reviewed');
                                toast.success('Record reviewed');
                                reload();
                            } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Transition failed');
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
            await operationalApi.remove(confirmDelete.id);
            toast.success('Record deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Operational (Petty Cash)</h2>
                <Button size="sm" onClick={() => router.push('/admin-log/operational/new')}>
                    <Plus size={14} />
                    New Entry
                </Button>
            </div>
            <DataTable<OperationalRecord>
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
                searchPlaceholder="Search vendor / category…"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete entry?"
                message={`This will soft-delete ${confirmDelete?.operational_record_number || 'the record'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

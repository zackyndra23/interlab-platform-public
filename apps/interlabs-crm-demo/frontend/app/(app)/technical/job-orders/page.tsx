'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { jobOrdersApi } from '@/lib/technical-api';
import { jobOrderWorkflowVariant, priorityVariant } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { JobOrderWorkflow, JobType, TechnicalJobOrder } from '@/lib/technical-types';

export default function JobOrdersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<TechnicalJobOrder[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [jobType, setJobType] = useState<JobType | ''>('');
    const [workflow, setWorkflow] = useState<JobOrderWorkflow | ''>('');
    const [reminderOnly, setReminderOnly] = useState(false);
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<TechnicalJobOrder | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await jobOrdersApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                job_type: jobType || undefined,
                workflow_status: workflow || undefined,
                due_date_reminder_flag: reminderOnly ? true : undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, jobType, workflow, reminderOnly]);

    const columns = useMemo<ColumnDef<TechnicalJobOrder>[]>(() => [
        { header: 'Record #', accessorKey: 'technical_job_order_number' },
        { header: 'PO #', accessorKey: 'related_po_number' },
        { header: 'Job Type', accessorKey: 'job_type' },
        {
            header: 'Priority', accessorKey: 'priority',
            cell: ({ getValue }) => {
                const p = getValue() as TechnicalJobOrder['priority'];
                return p ? <StatusBadge status={p} variant={priorityVariant(p)} /> : '—';
            },
        },
        {
            header: 'PO Due', accessorKey: 'po_due_date',
            cell: ({ row }) => (
                <span className="inline-flex items-center gap-1">
                    {formatDate(row.original.po_due_date)}
                    {row.original.due_date_reminder_flag && (
                        <AlarmClock size={12} className="text-amber-500" aria-label="30-day reminder" />
                    )}
                </span>
            ),
        },
        {
            header: 'Status', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as JobOrderWorkflow;
                return <StatusBadge status={s} variant={jobOrderWorkflowVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/technical/job-orders/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/technical/job-orders/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await jobOrdersApi.remove(confirmDelete.id);
            toast.success('Job Order deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Technical Job Orders</h2>
                    <p className="text-xs text-muted-foreground">
                        Master work orders linked to a Sales PO.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/technical/job-orders/new')}>
                    <Plus size={14} /> New Job Order
                </Button>
            </div>

            <DataTable<TechnicalJobOrder>
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
                searchPlaceholder="Search TJO number…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Job Type</label>
                        <select
                            value={jobType}
                            onChange={(e) => { setJobType(e.target.value as JobType | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="Installation">Installation</option>
                            <option value="PM">PM</option>
                            <option value="Sparepart">Sparepart</option>
                        </select>
                        <label className="text-muted-foreground">Status</label>
                        <select
                            value={workflow}
                            onChange={(e) => { setWorkflow(e.target.value as JobOrderWorkflow | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                        <label className="inline-flex items-center gap-1">
                            <input
                                type="checkbox"
                                checked={reminderOnly}
                                onChange={(e) => { setReminderOnly(e.target.checked); setPage(1); }}
                            />
                            <span className="text-muted-foreground">30-day reminders only</span>
                        </label>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete Job Order?"
                message={`This will soft-delete ${confirmDelete?.technical_job_order_number || 'the record'}.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

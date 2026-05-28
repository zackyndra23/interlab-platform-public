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
import { bastApi } from '@/lib/technical-api';
import { bastWorkflowVariant } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { BastRecord, BastWorkflow, JobType } from '@/lib/technical-types';

export default function BastListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<BastRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [workflow, setWorkflow] = useState<BastWorkflow | ''>('');
    const [jobType, setJobType] = useState<JobType | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<BastRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await bastApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                workflow_status: workflow || undefined,
                job_type: jobType || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, workflow, jobType]);

    const columns = useMemo<ColumnDef<BastRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'bast_record_number' },
        { header: 'Job Type', accessorKey: 'job_type',
          cell: ({ getValue }) => String(getValue() ?? '—') },
        {
            header: 'Completion', accessorKey: 'completion_end_date',
            cell: ({ row }) => formatDate(row.original.completion_end_date) || '—',
        },
        { header: 'Customer PIC', accessorKey: 'customer_pic',
          cell: ({ getValue }) => String(getValue() ?? '—') },
        {
            header: 'Status', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as BastWorkflow;
                return <StatusBadge status={s} variant={bastWorkflowVariant(s)} />;
            },
        },
        {
            header: 'Sent to Finance', accessorKey: 'sent_to_finance',
            cell: ({ row }) => row.original.sent_to_finance
                ? <StatusBadge status="Yes" variant="success" />
                : <StatusBadge status="No" variant="muted" />,
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/technical/bast/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        disabled={row.original.workflow_status === 'sent_to_finance'}
                        onClick={() => router.push(`/technical/bast/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        disabled={row.original.sent_to_finance}
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await bastApi.remove(confirmDelete.id);
            toast.success('BAST deleted');
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
                    <h2 className="text-lg font-semibold">BAST / Completion Docs</h2>
                    <p className="text-xs text-muted-foreground">
                        Submitting to Finance creates the Invoice Customer draft and advances PO → BAST.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/technical/bast/new')}>
                    <Plus size={14} /> New BAST
                </Button>
            </div>

            <DataTable<BastRecord>
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
                searchPlaceholder="Search BAST number…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Workflow</label>
                        <select
                            value={workflow}
                            onChange={(e) => { setWorkflow(e.target.value as BastWorkflow | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="draft">draft</option>
                            <option value="submitted">submitted</option>
                            <option value="sent_to_finance">sent_to_finance</option>
                        </select>
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
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete BAST?"
                message="BAST records sent to Finance cannot be deleted."
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

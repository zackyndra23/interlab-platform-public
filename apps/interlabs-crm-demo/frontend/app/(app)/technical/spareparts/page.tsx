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
import { sparepartsApi } from '@/lib/technical-api';
import {
    adminLogResponseVariant, sparepartWorkflowVariant, workingDaysSince,
} from '@/lib/technical-ui';
import type {
    AdminLogResponse, SparepartRecord, SparepartWorkflow,
} from '@/lib/technical-types';

export default function SparepartListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<SparepartRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [workflow, setWorkflow] = useState<SparepartWorkflow | ''>('');
    const [response, setResponse] = useState<AdminLogResponse | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<SparepartRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await sparepartsApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                workflow_status: workflow || undefined,
                admin_log_response_status: response || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, workflow, response]);

    const columns = useMemo<ColumnDef<SparepartRecord>[]>(() => [
        {
            header: 'Record', accessorKey: 'id',
            cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 8)}…</span>,
        },
        { header: 'Workshop Check', accessorKey: 'workshop_check_status' },
        {
            header: 'Workflow', accessorKey: 'workflow_status',
            cell: ({ getValue }) => {
                const s = getValue() as SparepartWorkflow;
                return <StatusBadge status={s} variant={sparepartWorkflowVariant(s)} />;
            },
        },
        {
            header: 'Ready to Deliver', accessorKey: 'ready_to_deliver',
            cell: ({ row }) => {
                const r = row.original;
                if (r.ready_to_deliver !== 'Yes') return '—';
                const days = workingDaysSince(r.ready_to_deliver_at);
                return (
                    <span className="inline-flex items-center gap-1 text-xs">
                        <StatusBadge
                            status={r.admin_log_response_status}
                            variant={adminLogResponseVariant(r.admin_log_response_status)}
                        />
                        {r.admin_log_response_status === 'pending' && (
                            <span className={days > 2 ? 'text-destructive' : 'text-muted-foreground'}>
                                {days}d
                            </span>
                        )}
                    </span>
                );
            },
        },
        { header: 'Delivery', accessorKey: 'delivery_method',
          cell: ({ getValue }) => String(getValue() ?? '—') },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/technical/spareparts/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/technical/spareparts/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await sparepartsApi.remove(confirmDelete.id);
            toast.success('Sparepart deleted');
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
                    <h2 className="text-lg font-semibold">Spareparts</h2>
                    <p className="text-xs text-muted-foreground">
                        AWB-tracked, workshop-checked, then handed off to Admin &amp; Log / Finance.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/technical/spareparts/new')}>
                    <Plus size={14} /> New Sparepart
                </Button>
            </div>
            <DataTable<SparepartRecord>
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
                searchPlaceholder="Search by job order id…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Workflow</label>
                        <select
                            value={workflow}
                            onChange={(e) => { setWorkflow(e.target.value as SparepartWorkflow | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="awaiting_awb">awaiting_awb</option>
                            <option value="workshop_check">workshop_check</option>
                            <option value="ready">ready</option>
                            <option value="dispatched">dispatched</option>
                        </select>
                        <label className="text-muted-foreground">Admin &amp; Log</label>
                        <select
                            value={response}
                            onChange={(e) => { setResponse(e.target.value as AdminLogResponse | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="pending">pending</option>
                            <option value="acknowledged">acknowledged</option>
                            <option value="dispatched">dispatched</option>
                        </select>
                    </div>
                }
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete sparepart?"
                message="Sparepart records that have been signalled RTD or dispatched cannot be deleted."
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

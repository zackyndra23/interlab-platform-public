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
import { installationsApi } from '@/lib/technical-api';
import {
    adminLogResponseVariant, installationPhaseVariant, workingDaysSince,
} from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type {
    AdminLogResponse, InstallationRecord, InstallationWorkflowPhase,
} from '@/lib/technical-types';

export default function InstallationsListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<InstallationRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [phase, setPhase] = useState<InstallationWorkflowPhase | ''>('');
    const [response, setResponse] = useState<AdminLogResponse | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<InstallationRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await installationsApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                workflow_phase: phase || undefined,
                admin_log_response_status: response || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, phase, response]);

    const columns = useMemo<ColumnDef<InstallationRecord>[]>(() => [
        {
            header: 'Record', accessorKey: 'id',
            cell: ({ row }) => (
                <span className="font-mono text-xs">{row.original.id.slice(0, 8)}…</span>
            ),
        },
        {
            header: 'Phase', accessorKey: 'workflow_phase',
            cell: ({ getValue }) => {
                const s = getValue() as InstallationWorkflowPhase;
                return <StatusBadge status={s} variant={installationPhaseVariant(s)} />;
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
        {
            header: 'Install Start', accessorKey: 'installation_start_date',
            cell: ({ getValue }) => formatDate(getValue() as string),
        },
        {
            header: 'Inspection', accessorKey: 'inspection_status',
            cell: ({ getValue }) => String(getValue() ?? '—'),
        },
        {
            header: 'Function Test', accessorKey: 'function_test_status',
            cell: ({ getValue }) => String(getValue() ?? '—'),
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/technical/installations/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        onClick={() => router.push(`/technical/installations/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await installationsApi.remove(confirmDelete.id);
            toast.success('Installation deleted');
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
                    <h2 className="text-lg font-semibold">Installations</h2>
                    <p className="text-xs text-muted-foreground">
                        Pre-install → QC → RTD → on-site → BAST. RTD days show working-days-since.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/technical/installations/new')}>
                    <Plus size={14} /> New Installation
                </Button>
            </div>
            <DataTable<InstallationRecord>
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
                        <label className="text-muted-foreground">Phase</label>
                        <select
                            value={phase}
                            onChange={(e) => { setPhase(e.target.value as InstallationWorkflowPhase | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="pre_installation">pre_installation</option>
                            <option value="workshop">workshop</option>
                            <option value="ready_to_deliver">ready_to_deliver</option>
                            <option value="scheduling">scheduling</option>
                            <option value="on_site">on_site</option>
                            <option value="commissioning">commissioning</option>
                            <option value="completed">completed</option>
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
                title="Delete installation?"
                message="Only draft-phase installations can be deleted."
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

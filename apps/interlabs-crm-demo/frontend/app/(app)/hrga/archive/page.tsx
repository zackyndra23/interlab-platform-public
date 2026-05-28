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
import { archiveApi } from '@/lib/hrga-api';
import { ARCHIVE_REASONS, archiveReasonVariant } from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type {
    ArchiveReason, ArchiveRecord, ArchiveSourceModule,
} from '@/lib/hrga-types';

const SOURCES: ArchiveSourceModule[] = ['legalitas', 'company_letters', 'other'];

export default function ArchiveListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<ArchiveRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [source, setSource] = useState<ArchiveSourceModule | ''>('');
    const [reason, setReason] = useState<ArchiveReason | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<ArchiveRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await archiveApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                source_module: source || undefined,
                archive_reason: reason || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, source, reason]);

    const columns = useMemo<ColumnDef<ArchiveRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'archive_record_number' },
        {
            header: 'Name', accessorKey: 'document_name',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Source', accessorKey: 'source_module',
            cell: ({ getValue }) => {
                const s = getValue() as ArchiveSourceModule;
                return <StatusBadge status={s} variant="muted" />;
            },
        },
        {
            header: 'Category', accessorKey: 'document_category',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Reason', accessorKey: 'archive_reason',
            cell: ({ getValue }) => {
                const r = getValue() as ArchiveReason;
                return <StatusBadge status={r} variant={archiveReasonVariant(r)} />;
            },
        },
        {
            header: 'Archived', accessorKey: 'archived_at',
            cell: ({ row }) => formatDate(row.original.archived_at) || '—',
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton icon={Eye} tooltip="View"
                            onClick={() => router.push(`/hrga/archive/${r.id}`)} />
                        <IconButton icon={Pencil} tooltip="Edit"
                            onClick={() => router.push(`/hrga/archive/${r.id}/edit`)} />
                        <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                            onClick={() => setConfirmDelete(r)} />
                    </div>
                );
            },
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await archiveApi.remove(confirmDelete.id);
            toast.success('Archive record deleted');
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
                    <h2 className="text-lg font-semibold">Archive & Repository</h2>
                    <p className="text-xs text-muted-foreground">
                        Mirror store for Superseded / Expired / Withdrawn documents. Still searchable via Smart Search per access scope.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/hrga/archive/new')}>
                    <Plus size={14} /> New Archive Entry
                </Button>
            </div>

            <DataTable<ArchiveRecord>
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
                searchPlaceholder="Search document name…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Source</label>
                        <select
                            value={source}
                            onChange={(e) => { setSource(e.target.value as ArchiveSourceModule | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {SOURCES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        <label className="text-muted-foreground">Reason</label>
                        <select
                            value={reason}
                            onChange={(e) => { setReason(e.target.value as ArchiveReason | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {ARCHIVE_REASONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete archive entry?"
                message="This removes the mirror record but does not resurrect the source document."
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

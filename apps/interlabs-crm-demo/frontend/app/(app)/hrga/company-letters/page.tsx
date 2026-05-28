'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Archive, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { companyLettersApi } from '@/lib/hrga-api';
import {
    LETTER_STATUSES, LETTER_TYPES, letterStatusVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { CompanyLetter, LetterStatus } from '@/lib/hrga-types';

export default function CompanyLettersListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<CompanyLetter[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [letterType, setLetterType] = useState('');
    const [status, setStatus] = useState<LetterStatus | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<CompanyLetter | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await companyLettersApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                letter_type: letterType || undefined,
                letter_status: status || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, letterType, status]);

    const columns = useMemo<ColumnDef<CompanyLetter>[]>(() => [
        { header: 'Record #', accessorKey: 'letter_record_number' },
        { header: 'Subject', accessorKey: 'subject' },
        {
            header: 'Type', accessorKey: 'letter_type',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Letter #', accessorKey: 'letter_number',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Issue Date', accessorKey: 'issue_date',
            cell: ({ row }) => formatDate(row.original.issue_date) || '—',
        },
        {
            header: 'Status', accessorKey: 'letter_status',
            cell: ({ getValue }) => {
                const s = getValue() as LetterStatus;
                return <StatusBadge status={s} variant={letterStatusVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => {
                const r = row.original;
                const archived = r.letter_status === 'Archived';
                const terminal = r.letter_status === 'Final'
                    || r.letter_status === 'Sent';
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton icon={Eye} tooltip="View"
                            onClick={() => router.push(`/hrga/company-letters/${r.id}`)} />
                        <IconButton icon={Pencil} tooltip="Edit"
                            disabled={archived}
                            onClick={() => router.push(`/hrga/company-letters/${r.id}/edit`)} />
                        <IconButton icon={Archive} tooltip="Archive"
                            disabled={archived}
                            onClick={() => router.push(`/hrga/company-letters/${r.id}/archive`)} />
                        <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                            disabled={terminal || archived}
                            onClick={() => setConfirmDelete(r)} />
                    </div>
                );
            },
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await companyLettersApi.remove(confirmDelete.id);
            toast.success('Letter deleted');
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
                    <h2 className="text-lg font-semibold">Company Letters</h2>
                    <p className="text-xs text-muted-foreground">
                        Draft → Under Review → Final → Sent → Archived. Final and Sent records cannot be soft-deleted; archive instead.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/hrga/company-letters/new')}>
                    <Plus size={14} /> New Letter
                </Button>
            </div>

            <DataTable<CompanyLetter>
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
                searchPlaceholder="Search subject…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Type</label>
                        <select
                            value={letterType}
                            onChange={(e) => { setLetterType(e.target.value); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {LETTER_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <label className="text-muted-foreground">Status</label>
                        <select
                            value={status}
                            onChange={(e) => { setStatus(e.target.value as LetterStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {LETTER_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete letter?"
                message={`Soft-delete ${confirmDelete?.letter_record_number ?? ''}?`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

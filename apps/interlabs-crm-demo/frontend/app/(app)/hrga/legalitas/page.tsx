'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Archive, Eye, History, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { legalDocumentsApi } from '@/lib/hrga-api';
import {
    complianceFlagLabel, complianceFlagVariant,
    LEGAL_DOCUMENT_CATEGORIES, LEGAL_STATUSES,
    legalDocumentStatusVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type {
    ComplianceFlag, LegalDocument, LegalDocumentStatus,
} from '@/lib/hrga-types';

export default function LegalitasListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<LegalDocument[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [status, setStatus] = useState<LegalDocumentStatus | ''>('');
    const [flag, setFlag] = useState<ComplianceFlag | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<LegalDocument | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await legalDocumentsApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                document_category: category || undefined,
                document_status: status || undefined,
                compliance_flag: flag || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, category, status, flag]);

    const columns = useMemo<ColumnDef<LegalDocument>[]>(() => [
        { header: 'Record #', accessorKey: 'legal_document_record_number' },
        { header: 'Name', accessorKey: 'document_name' },
        {
            header: 'Category', accessorKey: 'document_category',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Doc #', accessorKey: 'document_number',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Expiry', accessorKey: 'expiry_date',
            cell: ({ row }) => formatDate(row.original.expiry_date) || '—',
        },
        {
            header: 'Status', accessorKey: 'document_status',
            cell: ({ getValue }) => {
                const s = getValue() as LegalDocumentStatus;
                return <StatusBadge status={s} variant={legalDocumentStatusVariant(s)} />;
            },
        },
        {
            header: 'Compliance', accessorKey: 'compliance_flag',
            cell: ({ getValue }) => {
                const f = getValue() as ComplianceFlag;
                return (
                    <StatusBadge
                        status={complianceFlagLabel(f)}
                        variant={complianceFlagVariant(f)}
                    />
                );
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => {
                const r = row.original;
                const terminal = r.document_status === 'Superseded'
                    || r.document_status === 'Archived';
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton icon={Eye} tooltip="View"
                            onClick={() => router.push(`/hrga/legalitas/${r.id}`)} />
                        <IconButton icon={Pencil} tooltip="Edit"
                            disabled={terminal}
                            onClick={() => router.push(`/hrga/legalitas/${r.id}/edit`)} />
                        <IconButton icon={History} tooltip="New Version"
                            disabled={terminal}
                            onClick={() => router.push(`/hrga/legalitas/${r.id}/supersede`)} />
                        <IconButton icon={Archive} tooltip="Archive"
                            disabled={r.document_status === 'Archived'}
                            onClick={() => router.push(`/hrga/legalitas/${r.id}/archive`)} />
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
            await legalDocumentsApi.remove(confirmDelete.id);
            toast.success('Document deleted');
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
                    <h2 className="text-lg font-semibold">Legalitas</h2>
                    <p className="text-xs text-muted-foreground">
                        Structured legal / compliance repository. Versioning is handled via Supersede; expiry reminders fire 90 and 30 days before expiry_date.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/hrga/legalitas/new')}>
                    <Plus size={14} /> New Document
                </Button>
            </div>

            <DataTable<LegalDocument>
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
                        <label className="text-muted-foreground">Category</label>
                        <select
                            value={category}
                            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {LEGAL_DOCUMENT_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        <label className="text-muted-foreground">Status</label>
                        <select
                            value={status}
                            onChange={(e) => { setStatus(e.target.value as LegalDocumentStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {LEGAL_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        <label className="text-muted-foreground">Compliance</label>
                        <select
                            value={flag}
                            onChange={(e) => { setFlag(e.target.value as ComplianceFlag | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="ok">OK</option>
                            <option value="expiring_soon_90">Expiring ≤90d</option>
                            <option value="expiring_soon_30">Expiring ≤30d</option>
                            <option value="expired">Expired</option>
                        </select>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete legal document?"
                message={`Soft-delete ${confirmDelete?.legal_document_record_number ?? ''}? Active documents with a future expiry must be superseded or archived first.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

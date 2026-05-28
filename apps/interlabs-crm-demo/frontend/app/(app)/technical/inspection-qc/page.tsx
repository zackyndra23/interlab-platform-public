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
import { inspectionQcApi } from '@/lib/technical-api';
import {
    qcFinalSubmitVariant, qcResultVariant, qcReviewVariant,
} from '@/lib/technical-ui';
import type {
    InspectionQcRecord, QcFinalSubmitStatus, QcResult, QcReviewStatus,
} from '@/lib/technical-types';

export default function InspectionQcListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<InspectionQcRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [review, setReview] = useState<QcReviewStatus | ''>('');
    const [final, setFinal] = useState<QcFinalSubmitStatus | ''>('');
    const [result, setResult] = useState<QcResult | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<InspectionQcRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await inspectionQcApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                review_status: review || undefined,
                final_submit_status: final || undefined,
                qc_result: result || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, review, final, result]);

    const columns = useMemo<ColumnDef<InspectionQcRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'qc_record_number' },
        { header: 'Item / Equipment', accessorKey: 'item_or_equipment_name' },
        { header: 'Condition', accessorKey: 'item_condition',
          cell: ({ getValue }) => String(getValue() ?? '—') },
        { header: 'Defect', accessorKey: 'defect_category' },
        {
            header: 'QC Result', accessorKey: 'qc_result',
            cell: ({ getValue }) => {
                const s = getValue() as QcResult | null;
                return s ? <StatusBadge status={s} variant={qcResultVariant(s)} /> : '—';
            },
        },
        {
            header: 'Review', accessorKey: 'review_status',
            cell: ({ getValue }) => {
                const s = getValue() as QcReviewStatus;
                return <StatusBadge status={s} variant={qcReviewVariant(s)} />;
            },
        },
        {
            header: 'Final Submit', accessorKey: 'final_submit_status',
            cell: ({ getValue }) => {
                const s = getValue() as QcFinalSubmitStatus;
                return <StatusBadge status={s} variant={qcFinalSubmitVariant(s)} />;
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="View"
                        onClick={() => router.push(`/technical/inspection-qc/${row.original.id}`)} />
                    <IconButton icon={Pencil} tooltip="Edit"
                        disabled={row.original.final_submit_status === 'Submitted'}
                        onClick={() => router.push(`/technical/inspection-qc/${row.original.id}/edit`)} />
                    <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                        disabled={row.original.final_submit_status === 'Submitted'}
                        onClick={() => setConfirmDelete(row.original)} />
                </div>
            ),
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await inspectionQcApi.remove(confirmDelete.id);
            toast.success('QC record deleted');
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
                    <h2 className="text-lg font-semibold">Inspection &amp; QC</h2>
                    <p className="text-xs text-muted-foreground">
                        Draft → Review → Approved + Submitted advances PO → Inspected.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/technical/inspection-qc/new')}>
                    <Plus size={14} /> New QC
                </Button>
            </div>

            <DataTable<InspectionQcRecord>
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
                searchPlaceholder="Search QC number…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Review</label>
                        <select
                            value={review}
                            onChange={(e) => { setReview(e.target.value as QcReviewStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="Pending Review">Pending Review</option>
                            <option value="Reviewed">Reviewed</option>
                            <option value="Approved">Approved</option>
                        </select>
                        <label className="text-muted-foreground">Final Submit</label>
                        <select
                            value={final}
                            onChange={(e) => { setFinal(e.target.value as QcFinalSubmitStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="Draft">Draft</option>
                            <option value="Submitted">Submitted</option>
                        </select>
                        <label className="text-muted-foreground">QC Result</label>
                        <select
                            value={result}
                            onChange={(e) => { setResult(e.target.value as QcResult | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="Pass">Pass</option>
                            <option value="Need Fix">Need Fix</option>
                            <option value="Reject">Reject</option>
                        </select>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete QC record?"
                message="Submitted QC records cannot be deleted."
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

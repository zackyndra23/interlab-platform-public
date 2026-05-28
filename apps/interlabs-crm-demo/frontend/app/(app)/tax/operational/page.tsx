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
import { taxOperationalApi } from '@/lib/tax-api';
import {
    PAYMENT_STATUSES, RECORD_STATUSES,
    TAX_CATEGORIES, TAX_TYPES,
    formatMasaPajak, formatNpwp,
    paymentStatusVariant, recordStatusVariant, taxCategoryVariant,
    yearOptions,
} from '@/lib/tax-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type {
    PaymentStatus, RecordStatus, TaxCategory, TaxOperationalRecord, TaxType,
} from '@/lib/tax-types';

export default function TaxOperationalListPage() {
    const router = useRouter();
    const [rows, setRows] = useState<TaxOperationalRecord[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [taxType, setTaxType] = useState<TaxType | ''>('');
    const [category, setCategory] = useState<TaxCategory | ''>('');
    const [recordStatus, setRecordStatus] = useState<RecordStatus | ''>('');
    const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
    const [masaMonth, setMasaMonth] = useState<number | ''>('');
    const [masaYear, setMasaYear] = useState<number | ''>('');
    const [tahunPajak, setTahunPajak] = useState<number | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState<TaxOperationalRecord | null>(null);

    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const res = await taxOperationalApi.list({
                page, limit,
                search: debouncedSearch || undefined,
                tax_type: taxType || undefined,
                tax_category: category || undefined,
                record_status: recordStatus || undefined,
                payment_status: paymentStatus || undefined,
                masa_pajak_month: masaMonth || undefined,
                masa_pajak_year: masaYear || undefined,
                tahun_pajak: tahunPajak || undefined,
            });
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, debouncedSearch, taxType, category,
            recordStatus, paymentStatus, masaMonth, masaYear, tahunPajak]);

    const columns = useMemo<ColumnDef<TaxOperationalRecord>[]>(() => [
        { header: 'Record #', accessorKey: 'tax_operational_record_number' },
        { header: 'Tax Type', accessorKey: 'tax_type' },
        {
            header: 'Category', accessorKey: 'tax_category',
            cell: ({ getValue }) => {
                const c = getValue() as TaxCategory;
                return <StatusBadge status={c} variant={taxCategoryVariant(c)} />;
            },
        },
        {
            header: 'Masa Pajak', id: 'masa_pajak',
            accessorFn: (r) => r.masa_pajak_year ?? 0,
            cell: ({ row }) => formatMasaPajak(
                row.original.masa_pajak_month,
                row.original.masa_pajak_year,
            ) || '—',
        },
        {
            header: 'Tahun Pajak', accessorKey: 'tahun_pajak',
            cell: ({ getValue }) => (getValue() as number) || '—',
        },
        {
            header: 'NPWP', accessorKey: 'npwp',
            cell: ({ getValue }) => formatNpwp(getValue() as string) || '—',
        },
        {
            header: 'Taxpayer', accessorKey: 'taxpayer_name',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Amount', accessorKey: 'amount',
            cell: ({ row }) => {
                const v = row.original.amount;
                if (v === null || v === undefined || v === '') return '—';
                const n = typeof v === 'string' ? Number(v) : v;
                if (!Number.isFinite(n)) return '—';
                return formatCurrency(n, row.original.currency || 'IDR');
            },
        },
        {
            header: 'Payment', accessorKey: 'payment_status',
            cell: ({ getValue }) => {
                const s = getValue() as PaymentStatus;
                return <StatusBadge status={s} variant={paymentStatusVariant(s)} />;
            },
        },
        {
            header: 'Record', accessorKey: 'record_status',
            cell: ({ getValue }) => {
                const s = getValue() as RecordStatus;
                return <StatusBadge status={s} variant={recordStatusVariant(s)} />;
            },
        },
        {
            header: 'Payment Date', accessorKey: 'payment_date',
            cell: ({ row }) => formatDate(row.original.payment_date) || '—',
        },
        {
            header: 'Reporting Date', accessorKey: 'reporting_date',
            cell: ({ row }) => formatDate(row.original.reporting_date) || '—',
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => {
                const r = row.original;
                const archived = r.record_status === 'Archived';
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton icon={Eye} tooltip="View"
                            onClick={() => router.push(`/tax/operational/${r.id}`)} />
                        <IconButton icon={Pencil} tooltip="Edit"
                            disabled={archived}
                            onClick={() => router.push(`/tax/operational/${r.id}/edit`)} />
                        <IconButton icon={Trash2} tooltip="Delete" variant="danger"
                            disabled={archived || r.record_status === 'Verified'}
                            onClick={() => setConfirmDelete(r)} />
                    </div>
                );
            },
        },
    ], [router]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await taxOperationalApi.remove(confirmDelete.id);
            toast.success('Tax record deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    function exportCsv(): void {
        if (rows.length === 0) {
            toast.message('No rows to export');
            return;
        }
        const headers = [
            'Record #', 'Tax Type', 'Tax Category',
            'Masa Pajak', 'Tahun Pajak', 'NPWP', 'Taxpayer',
            'Amount', 'Currency',
            'Payment Status', 'Record Status',
            'Payment Date', 'Reporting Date', 'PIC',
        ];
        const escape = (v: unknown): string => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.join(',')];
        for (const r of rows) {
            lines.push([
                r.tax_operational_record_number,
                r.tax_type,
                r.tax_category,
                formatMasaPajak(r.masa_pajak_month, r.masa_pajak_year),
                r.tahun_pajak ?? '',
                formatNpwp(r.npwp),
                r.taxpayer_name ?? '',
                r.amount ?? '',
                r.currency ?? '',
                r.payment_status,
                r.record_status,
                formatDate(r.payment_date),
                formatDate(r.reporting_date),
                r.pic_user_id ?? '',
            ].map(escape).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tax-operational-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Tax Operational</h2>
                    <p className="text-xs text-muted-foreground">
                        Indonesian tax compliance: SSP payments and SPT reporting for PPh 21, PPh 25, PPN, and other taxes. Every mutation writes to the audit log.
                    </p>
                </div>
                <Button size="sm" onClick={() => router.push('/tax/operational/new')}>
                    <Plus size={14} /> New Record
                </Button>
            </div>

            <DataTable<TaxOperationalRecord>
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
                searchPlaceholder="Search NPWP, taxpayer, billing code, NTPN…"
                onExport={exportCsv}
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Tax Type</label>
                        <select
                            value={taxType}
                            onChange={(e) => { setTaxType(e.target.value as TaxType | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {TAX_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>

                        <label className="text-muted-foreground">Category</label>
                        <select
                            value={category}
                            onChange={(e) => { setCategory(e.target.value as TaxCategory | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {TAX_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        <label className="text-muted-foreground">Record</label>
                        <select
                            value={recordStatus}
                            onChange={(e) => { setRecordStatus(e.target.value as RecordStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {RECORD_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>

                        <label className="text-muted-foreground">Payment</label>
                        <select
                            value={paymentStatus}
                            onChange={(e) => { setPaymentStatus(e.target.value as PaymentStatus | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {PAYMENT_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>

                        <label className="text-muted-foreground">Masa</label>
                        <select
                            value={masaMonth}
                            onChange={(e) => {
                                setMasaMonth(e.target.value ? Number(e.target.value) : '');
                                setPage(1);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">Any</option>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <select
                            value={masaYear}
                            onChange={(e) => {
                                setMasaYear(e.target.value ? Number(e.target.value) : '');
                                setPage(1);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">Any</option>
                            {yearOptions().map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>

                        <label className="text-muted-foreground">Tahun</label>
                        <select
                            value={tahunPajak}
                            onChange={(e) => {
                                setTahunPajak(e.target.value ? Number(e.target.value) : '');
                                setPage(1);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            {yearOptions().map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                }
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete tax record?"
                message={`Soft-delete ${confirmDelete?.tax_operational_record_number ?? ''}? Verified and Archived records cannot be deleted.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

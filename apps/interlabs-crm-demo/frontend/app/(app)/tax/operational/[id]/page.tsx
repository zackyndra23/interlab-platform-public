'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { taxOperationalApi } from '@/lib/tax-api';
import {
    auditActionVariant,
    formatMasaPajak, formatNpwp,
    paymentStatusVariant, recordStatusVariant, taxCategoryVariant,
} from '@/lib/tax-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type {
    TaxAuditLogRow, TaxOperationalRecord,
} from '@/lib/tax-types';

export default function TaxOperationalDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<TaxOperationalRecord | null>(null);
    const [audit, setAudit] = useState<TaxAuditLogRow[]>([]);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try {
            const [record, auditRes] = await Promise.all([
                taxOperationalApi.get(params.id),
                taxOperationalApi.audit(params.id, { limit: 25 }),
            ]);
            setRow(record);
            setAudit(auditRes.rows);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Load failed');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const archived = row.record_status === 'Archived';
    const isSspOnly = row.tax_category === 'SSP Payment';
    const isSptOnly = row.tax_category === 'SPT Reporting';

    const amountDisplay = row.amount !== null && row.amount !== undefined && row.amount !== ''
        ? formatCurrency(
            typeof row.amount === 'string' ? Number(row.amount) : row.amount,
            row.currency || 'IDR',
        )
        : '—';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">
                        {row.tax_type} · {formatMasaPajak(row.masa_pajak_month, row.masa_pajak_year) || '—'}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {row.tax_operational_record_number}
                        {row.taxpayer_name ? ` · ${row.taxpayer_name}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={row.tax_category}
                        variant={taxCategoryVariant(row.tax_category)}
                    />
                    <StatusBadge
                        status={row.record_status}
                        variant={recordStatusVariant(row.record_status)}
                    />
                    <StatusBadge
                        status={row.payment_status}
                        variant={paymentStatusVariant(row.payment_status)}
                    />
                    <Button size="sm" variant="outline" disabled={archived}
                        onClick={() => router.push(`/tax/operational/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            {archived && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    This record is Archived. Edits are blocked. The audit trail below is preserved for regulator review.
                </div>
            )}

            <DetailSection title="Classification" fields={[
                { label: 'Tax Type', value: row.tax_type },
                { label: 'Tax Category', value: row.tax_category },
                { label: 'Masa Pajak', value: formatMasaPajak(row.masa_pajak_month, row.masa_pajak_year) },
                { label: 'Tahun Pajak', value: row.tahun_pajak },
            ]} />

            <DetailSection title="Taxpayer Identity" fields={[
                { label: 'NPWP', value: formatNpwp(row.npwp) },
                { label: 'Taxpayer Name', value: row.taxpayer_name },
                { label: 'Taxpayer Address', value: row.taxpayer_address, span: 2 },
            ]} />

            {!isSspOnly && (
                <DetailSection title="SPT Reporting" fields={[
                    { label: 'Jenis SPT', value: row.jenis_spt },
                    { label: 'Status SPT', value: row.status_spt },
                    { label: 'Reporting Date', value: formatDate(row.reporting_date) },
                ]} />
            )}

            {!isSptOnly && (
                <DetailSection title="SSP / Billing & Payment" fields={[
                    { label: 'Billing Code', value: row.billing_code },
                    { label: 'NTPN', value: row.ntpn },
                    { label: 'NTB', value: row.ntb },
                    { label: 'STAN', value: row.stan },
                    { label: 'Bank', value: row.bank_name },
                    { label: 'Payment Date', value: formatDate(row.payment_date) },
                    { label: 'Amount', value: amountDisplay },
                    { label: 'Currency', value: row.currency },
                ]} />
            )}

            <DetailSection title="Status & Assignment" fields={[
                { label: 'Record Status', value: row.record_status },
                { label: 'Payment Status', value: row.payment_status },
                { label: 'PIC User', value: row.pic_user_id },
                { label: 'Created', value: formatDate(row.created_at, { withTime: true }) },
                { label: 'Updated', value: formatDate(row.updated_at, { withTime: true }) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>

            <section className="rounded-md border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">Audit Trail</h3>
                {audit.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No audit entries yet.</p>
                ) : (
                    <ul className="divide-y divide-border rounded-md border border-border text-sm">
                        {audit.map((a) => (
                            <li key={a.id} className="flex flex-col gap-1 px-3 py-2 md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-2">
                                    <StatusBadge
                                        status={a.action}
                                        variant={auditActionVariant(a.action)}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        {a.actor_role || 'system'}
                                    </span>
                                </div>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {formatDate(a.created_at, { withTime: true })}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

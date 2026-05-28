'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { quotationsApi } from '@/lib/sales-api';
import { quotationVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Quotation, QuotationWorkflow } from '@/lib/sales-types';

const TRANSITIONS: QuotationWorkflow[] = [
    'submitted', 'revised', 'accepted', 'rejected',
];

export default function QuotationDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<Quotation | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await quotationsApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    async function transition(next: QuotationWorkflow): Promise<void> {
        if (!row) return;
        try {
            await quotationsApi.transition(row.id, next);
            toast.success(`Moved to ${next}`);
            load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Transition failed');
        }
    }

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">
                        Quotation {row.quotation_number || row.quotation_record_number}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {row.quotation_record_number}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={quotationVariant(row.workflow_status)} />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/sales/quotations/${row.id}/edit`)}
                    >
                        <Pencil size={14} />
                        Edit
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap gap-1">
                {TRANSITIONS.map((t) => (
                    <Button
                        key={t}
                        size="sm"
                        variant={t === row.workflow_status ? 'secondary' : 'outline'}
                        disabled={t === row.workflow_status}
                        onClick={() => transition(t)}
                    >
                        {t}
                    </Button>
                ))}
            </div>

            <DetailSection title="Header" fields={[
                { label: 'Quotation Date', value: formatDate(row.quotation_date) },
                { label: 'Validity', value: formatDate(row.validity_date) },
                { label: 'Currency', value: row.currency },
                { label: 'Payment Terms', value: row.payment_terms },
                { label: 'Delivery Terms', value: row.delivery_terms },
                { label: 'Warranty', value: row.warranty_terms },
            ]} />

            <DetailSection title="Line Items">
                <ItemTable items={row.item_list} currency={row.currency} />
            </DetailSection>

            <DetailSection title="Totals" fields={[
                { label: 'Subtotal', value: formatCurrency(row.subtotal, row.currency) },
                {
                    label: 'Discount',
                    value: `${row.discount_percent ?? 0}% (${formatCurrency(row.discount_amount, row.currency)})`,
                },
                {
                    label: 'Tax',
                    value: `${row.tax_percent ?? 0}% (${formatCurrency(row.tax_amount, row.currency)})`,
                },
                { label: 'Total', value: formatCurrency(row.total_amount, row.currency) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

function ItemTable({ items, currency }: {
    items: Quotation['item_list'];
    currency: Quotation['currency'];
}) {
    if (!items || items.length === 0) {
        return <p className="text-sm text-muted-foreground">No items</p>;
    }
    return (
        <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                    <th className="px-2 py-1 text-left">Item</th>
                    <th className="px-2 py-1 text-left">Description</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-left">Unit</th>
                    <th className="px-2 py-1 text-right">Unit Price</th>
                    <th className="px-2 py-1 text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                {items.map((it, idx) => (
                    <tr key={idx} className="border-t border-border">
                        <td className="px-2 py-1">{it.item_name}</td>
                        <td className="px-2 py-1">{it.description || '—'}</td>
                        <td className="px-2 py-1 text-right">{it.qty}</td>
                        <td className="px-2 py-1">{it.unit}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(it.unit_price, currency)}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(it.total_price, currency)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

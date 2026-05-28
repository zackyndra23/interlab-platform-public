'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { poCustomersApi } from '@/lib/finance-api';
import { poCustomerWorkflowVariant } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { PoCustomer } from '@/lib/finance-types';

export default function PoCustomerDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<PoCustomer | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        poCustomersApi.get(params.id)
            .then((r) => { if (!cancelled) setRow(r); })
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.po_customer_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        Customer PO {row.po_customer_number || '—'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {row.current_po_status && (
                        <StatusBadge status={row.current_po_status} variant="info" />
                    )}
                    <StatusBadge status={row.workflow_status}
                        variant={poCustomerWorkflowVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/finance/po-customers/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Header" fields={[
                { label: 'Version', value: row.version },
                { label: 'Order Date', value: formatDate(row.order_date) },
                { label: 'Currency', value: row.currency },
                { label: 'Payment Term Condition', value: row.payment_term_condition },
                { label: 'Delivery Term', value: row.delivery_term },
                { label: 'Term of Payment', value: row.term_of_payment },
                { label: 'Warranty', value: row.warranty },
                { label: 'Penalty Clause', value: row.penalty_clause, span: 2 },
                { label: 'Bill To', value: row.bill_to, span: 2 },
                { label: 'Ship To', value: row.ship_to, span: 2 },
            ]} />

            <DetailSection title="Items">
                {row.item_list && row.item_list.length > 0 ? (
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
                            {row.item_list.map((it, idx) => (
                                <tr key={idx} className="border-t border-border">
                                    <td className="px-2 py-1">{it.item_name}</td>
                                    <td className="px-2 py-1">{it.description || '—'}</td>
                                    <td className="px-2 py-1 text-right">{it.qty}</td>
                                    <td className="px-2 py-1">{it.unit}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(it.unit_price, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(it.total_price, row.currency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <p className="text-sm text-muted-foreground">No items</p>}
            </DetailSection>

            <DetailSection title="Totals" fields={[
                { label: 'Subtotal', value: formatCurrency(row.subtotal, row.currency) },
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

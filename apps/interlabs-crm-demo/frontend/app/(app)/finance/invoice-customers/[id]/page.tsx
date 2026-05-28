'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { UploadInvoicePanel } from '@/components/finance/UploadInvoicePanel';
import { invoiceCustomersApi } from '@/lib/finance-api';
import { invoiceCustomerStatusVariant } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceCustomer } from '@/lib/finance-types';

export default function InvoiceCustomerDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<InvoiceCustomer | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await invoiceCustomersApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.invoice_customer_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.invoice_number || '(not issued)'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.invoice_status}
                        variant={invoiceCustomerStatusVariant(row.invoice_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/finance/invoice-customers/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            {row.invoice_status === 'Registered' && (
                <UploadInvoicePanel invoice={row} onProcessed={load} />
            )}

            <DetailSection title="Header" fields={[
                { label: 'Invoice Date', value: formatDate(row.invoice_date) },
                { label: 'Customer Order #', value: row.customer_order_number },
                { label: 'Order Date', value: formatDate(row.order_date) },
                { label: 'Currency', value: row.currency },
                { label: 'Shipping Method', value: row.shipping_method },
                { label: 'Payment Due Date', value: formatDate(row.payment_due_date) },
                { label: 'Related PO Customer', value: row.related_po_customer_id },
                { label: 'Related BAST', value: row.related_bast_id },
                { label: 'Related DO', value: row.related_do_id },
            ]} />

            <DetailSection title="Items">
                {row.item_list && row.item_list.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-2 py-1 text-left">Item</th>
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
                { label: 'Discount', value: formatCurrency(row.discount_amount, row.currency) },
                { label: 'Tax Base', value: formatCurrency(row.tax_base, row.currency) },
                {
                    label: 'VAT',
                    value: `${row.vat_percent ?? 0}% (${formatCurrency(row.vat_amount, row.currency)})`,
                },
                { label: 'Total', value: formatCurrency(row.total_amount, row.currency) },
            ]} />

            <DetailSection title="Billing Account Info">
                <p className="whitespace-pre-wrap text-sm">
                    {row.billing_account_info || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

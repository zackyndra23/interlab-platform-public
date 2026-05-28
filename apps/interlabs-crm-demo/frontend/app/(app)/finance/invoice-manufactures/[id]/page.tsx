'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { AttachmentList } from '@/components/shared/AttachmentList';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { UploadPaymentPanel } from '@/components/finance/UploadPaymentPanel';
import { invoiceManufacturesApi } from '@/lib/finance-api';
import { invoiceMfgPaymentVariant, isOverdueDueDate } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvoiceManufacture } from '@/lib/finance-types';

export default function InvoiceManufactureDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<InvoiceManufacture | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await invoiceManufacturesApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const overdue = row.payment_status === 'Unpaid' && isOverdueDueDate(row.due_date);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.invoice_manufacture_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.invoice_number || '—'} · {row.supplier_or_manufacturer || '—'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {overdue && <StatusBadge status="Overdue" variant="danger" />}
                    <StatusBadge status={row.payment_status} variant={invoiceMfgPaymentVariant(row.payment_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/finance/invoice-manufactures/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            {row.payment_status === 'Unpaid' && (
                <UploadPaymentPanel invoice={row} onPaid={load} />
            )}

            <DetailSection title="Invoice Header" fields={[
                { label: 'PO Out Number', value: row.related_po_out_number },
                { label: 'Invoice Date', value: formatDate(row.invoice_date) },
                { label: 'Due Date', value: formatDate(row.due_date) },
                { label: 'Payment Terms', value: row.payment_terms },
                { label: 'Preferred Shipping', value: row.preferred_shipping },
                { label: 'Incoterm', value: row.incoterm },
                { label: 'Currency', value: row.currency },
                { label: 'Exchange Rate', value: row.exchange_rate },
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
                { label: 'Untaxed', value: formatCurrency(row.untaxed_amount, row.currency) },
                {
                    label: 'VAT',
                    value: `${row.vat_percent ?? 0}% (${formatCurrency(row.vat_amount, row.currency)})`,
                },
                { label: 'Total', value: formatCurrency(row.total_amount, row.currency) },
            ]} />

            <DetailSection title="Bank Details" fields={[
                { label: 'Bank', value: row.bank_name },
                { label: 'IBAN / Account', value: row.iban_or_account_number },
                { label: 'BIC / SWIFT', value: row.bic_swift },
                { label: 'Transaction Ref', value: row.transaction_reference },
            ]} />

            <DetailSection title="Payment" fields={[
                { label: 'Payment Date', value: formatDate(row.payment_date) },
                { label: 'Payment Amount', value: formatCurrency(row.payment_amount, row.currency) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>

            <DetailSection title="Attachments">
                <AttachmentList files={row.attachments ?? []} />
            </DetailSection>
        </div>
    );
}

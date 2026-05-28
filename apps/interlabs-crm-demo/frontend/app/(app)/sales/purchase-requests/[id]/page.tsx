'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { purchaseRequestsApi } from '@/lib/sales-api';
import { prVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { PurchaseRequestSales } from '@/lib/sales-types';

export default function PurchaseRequestDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<PurchaseRequestSales | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await purchaseRequestsApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    async function submit(): Promise<void> {
        if (!row) return;
        try {
            await purchaseRequestsApi.submit(row.id);
            toast.success('PR submitted to Finance');
            load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Submit failed');
        }
    }

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">PR {row.pr_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.supplier_or_manufacturer || '(unspecified supplier)'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={prVariant(row.workflow_status)} />
                    {row.workflow_status === 'draft' && (
                        <Button size="sm" onClick={submit}>
                            <Send size={14} /> Submit
                        </Button>
                    )}
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/sales/purchase-requests/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Header" fields={[
                { label: 'Related PO', value: row.related_po_id },
                { label: 'PR Date', value: formatDate(row.pr_date) },
                { label: 'Incoterm', value: row.incoterm },
                { label: 'Delivery Time', value: row.delivery_time },
                { label: 'Payment Terms', value: row.payment_terms },
                { label: 'Currency', value: row.currency },
            ]} />

            <DetailSection title="Supplier" fields={[
                { label: 'Supplier / Manufacturer', value: row.supplier_or_manufacturer, span: 2 },
                { label: 'Contact', value: row.manufacturer_contact },
                { label: 'Email', value: row.manufacturer_email },
                { label: 'Shipping Address', value: row.shipping_address, span: 2 },
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

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

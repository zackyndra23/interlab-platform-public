'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { UploadPoOutPanel } from '@/components/finance/UploadPoOutPanel';
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import { prStatusVariant } from '@/lib/finance-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { PurchaseRequisition } from '@/lib/finance-types';

export default function PurchaseRequisitionDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<PurchaseRequisition | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await purchaseRequisitionsApi.get(params.id)); }
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
                    <h2 className="text-lg font-semibold">{row.pr_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        PR {row.pr_number || '—'} · {row.supplier_or_manufacturer || '—'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.current_pr_status} variant={prStatusVariant(row.current_pr_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/finance/purchase-requisitions/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            {row.current_pr_status === 'Registered' && (
                <UploadPoOutPanel pr={row} onProcessed={load} />
            )}

            <DetailSection title="Header" fields={[
                { label: 'PR Date', value: formatDate(row.pr_date) },
                { label: 'Currency', value: row.currency },
                { label: 'Supplier / Manufacturer', value: row.supplier_or_manufacturer },
                { label: 'Contact', value: row.manufacturer_contact_person },
                { label: 'Email', value: row.manufacturer_email },
                { label: 'Incoterm', value: row.incoterm },
                { label: 'Delivery Time', value: row.delivery_time },
                { label: 'Payment Term', value: row.payment_term },
                { label: 'Shipping Address', value: row.shipping_address, span: 2 },
            ]} />

            <DetailSection title="PO Out (to Manufacturer)" fields={[
                { label: 'PO Out Number', value: row.po_out_number },
                { label: 'PO Out Date', value: formatDate(row.po_out_date) },
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

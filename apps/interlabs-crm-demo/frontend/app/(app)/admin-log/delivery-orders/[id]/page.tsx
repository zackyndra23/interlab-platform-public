'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { deliveryOrdersApi } from '@/lib/admin-log-api';
import { doStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type {
    DeliveryOrder, DoStatusHistoryEntry,
} from '@/lib/admin-log-types';

export default function DeliveryOrderDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<DeliveryOrder | null>(null);
    const [history, setHistory] = useState<DoStatusHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [record, hist] = await Promise.all([
                    deliveryOrdersApi.get(params.id),
                    deliveryOrdersApi.history(params.id).catch(() => []),
                ]);
                if (cancelled) return;
                setRow(record);
                setHistory(hist as DoStatusHistoryEntry[]);
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Load failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">
                        DO {row.delivery_order_number || row.do_record_number}
                    </h2>
                    <p className="text-xs text-muted-foreground">{row.do_record_number}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.current_do_status} variant={doStatusVariant(row.current_do_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/admin-log/delivery-orders/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Header" fields={[
                { label: 'PO', value: row.related_po_number || row.related_po_id },
                { label: 'Delivery Date', value: formatDate(row.delivery_date) },
                { label: 'Shipping Method', value: row.shipping_method },
                { label: 'Courier / Vendor', value: row.courier_or_expedition_vendor },
                { label: 'Dispatch From', value: row.dispatch_from },
                { label: 'Technical Inspection', value: formatDate(row.technical_inspection_reference_date) },
                { label: 'Customer Arrival', value: formatDate(row.customer_arrival_date) },
                { label: 'Delivery Address', value: row.delivery_address, span: 2 },
                { label: 'Invoicing Address', value: row.invoicing_address, span: 2 },
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
                            </tr>
                        </thead>
                        <tbody>
                            {row.item_list.map((it, idx) => (
                                <tr key={idx} className="border-t border-border">
                                    <td className="px-2 py-1">{it.item_name}</td>
                                    <td className="px-2 py-1">{it.description || '—'}</td>
                                    <td className="px-2 py-1 text-right">{it.qty ?? '—'}</td>
                                    <td className="px-2 py-1">{it.unit ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <p className="text-sm text-muted-foreground">No items</p>}
            </DetailSection>

            <DetailSection title="Status History">
                {history.length === 0
                    ? <p className="text-sm text-muted-foreground">No history yet</p>
                    : (
                        <ul className="space-y-2 text-sm">
                            {history.map((h) => (
                                <li key={h.id} className="flex items-start justify-between border-b border-border pb-1 last:border-b-0">
                                    <div>
                                        <p className="font-medium">{h.status_code}</p>
                                        {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDate(h.created_at, { withTime: true })}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
            </DetailSection>

            <DetailSection title="Remarks">
                <p className="whitespace-pre-wrap text-sm">
                    {row.remarks || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

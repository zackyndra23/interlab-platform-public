'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { AttachmentList } from '@/components/shared/AttachmentList';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { awbApi } from '@/lib/admin-log-api';
import { awbStatusVariant } from '@/lib/admin-log-ui';
import { formatDate } from '@/lib/utils';
import type { AwbRecord, AwbStatusHistoryEntry } from '@/lib/admin-log-types';

export default function AwbDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<AwbRecord | null>(null);
    const [history, setHistory] = useState<AwbStatusHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [record, hist] = await Promise.all([
                    awbApi.get(params.id),
                    awbApi.history(params.id).catch(() => []),
                ]);
                if (cancelled) return;
                setRow(record);
                setHistory(hist as AwbStatusHistoryEntry[]);
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
                    <h2 className="text-lg font-semibold">AWB {row.awb_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        PO {row.related_po_number || row.related_po_id}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.current_awb_status} variant={awbStatusVariant(row.current_awb_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/admin-log/awb/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Shipment" fields={[
                { label: 'Tracking #', value: row.awb_tracking_number },
                { label: 'Shipment Method', value: row.shipment_method },
                { label: 'Supplier / Manufacturer', value: row.supplier_or_manufacturer },
                { label: 'Forwarder / Courier', value: row.forwarder_or_courier },
                { label: 'Origin', value: row.origin_country },
                { label: 'Transit Hub', value: row.transit_country_or_hub },
                { label: 'Destination', value: row.destination },
                { label: 'Incoterm', value: row.incoterm },
            ]} />

            <DetailSection title="Dates" fields={[
                { label: 'Despatch', value: formatDate(row.despatch_date) },
                { label: 'Transit', value: formatDate(row.transit_date) },
                { label: 'Arrival', value: formatDate(row.arrival_date) },
            ]} />

            <DetailSection title="Cargo" fields={[
                { label: 'Weight (kg)', value: row.weight_kg ?? null },
                { label: 'Packages', value: row.package_count ?? null },
                { label: 'Description', value: row.description_of_goods, span: 2 },
                { label: 'Notes', value: row.notes, span: 2 },
            ]} />

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

            <DetailSection title="Attachments">
                <AttachmentList files={row.attachments ?? []} />
            </DetailSection>
        </div>
    );
}

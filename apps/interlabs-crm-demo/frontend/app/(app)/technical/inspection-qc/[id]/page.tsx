'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { CrossDivisionContext } from '@/components/technical/CrossDivisionContext';
import { QcReviewPanel } from '@/components/technical/QcReviewPanel';
import { inspectionQcApi } from '@/lib/technical-api';
import {
    qcFinalSubmitVariant, qcResultVariant, qcReviewVariant,
} from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { InspectionQcRecord } from '@/lib/technical-types';

export default function QcDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<InspectionQcRecord | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await inspectionQcApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const locked = row.final_submit_status === 'Submitted';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.qc_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.item_or_equipment_name || 'QC record'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.review_status} variant={qcReviewVariant(row.review_status)} />
                    <StatusBadge status={row.final_submit_status}
                        variant={qcFinalSubmitVariant(row.final_submit_status)} />
                    <Button size="sm" variant="outline" disabled={locked}
                        onClick={() => router.push(`/technical/inspection-qc/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <CrossDivisionContext relatedPoId={row.related_po_id} />

            {!locked && <QcReviewPanel qc={row} onUpdated={load} />}

            <DetailSection title="Inspection" fields={[
                { label: 'Item / Equipment', value: row.item_or_equipment_name },
                { label: 'Condition', value: row.item_condition || '—' },
                { label: 'Defect Category', value: row.defect_category },
                {
                    label: 'QC Result',
                    value: row.qc_result
                        ? <StatusBadge status={row.qc_result} variant={qcResultVariant(row.qc_result)} />
                        : '—',
                },
                { label: 'PIC', value: row.pic_user_id },
                { label: 'Last Update', value: formatDate(row.updated_at, { withTime: true }) },
                { label: 'Defect Description', value: row.defect_description, span: 2 },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

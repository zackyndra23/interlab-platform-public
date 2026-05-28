'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { CrossDivisionContext } from '@/components/technical/CrossDivisionContext';
import { sparepartsApi } from '@/lib/technical-api';
import {
    adminLogResponseVariant, sparepartWorkflowVariant, workingDaysSince,
} from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { SparepartRecord } from '@/lib/technical-types';

export default function SparepartDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<SparepartRecord | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await sparepartsApi.get(params.id)); }
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
                    <h2 className="text-lg font-semibold">Sparepart</h2>
                    <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status}
                        variant={sparepartWorkflowVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/technical/spareparts/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <CrossDivisionContext relatedPoId={row.related_po_id} />

            {row.ready_to_deliver === 'Yes' && row.admin_log_response_status === 'pending' && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    Awaiting Admin &amp; Log response —
                    <strong className="ml-1">
                        {workingDaysSince(row.ready_to_deliver_at)} working day(s)
                    </strong>{' '}
                    since Ready-to-Deliver signal. SLA is 2 working days.
                </div>
            )}

            <DetailSection title="Handoff" fields={[
                { label: 'Workshop Check', value: row.workshop_check_status },
                { label: 'Ready to Deliver', value: row.ready_to_deliver || '—' },
                { label: 'Delivery Method', value: row.delivery_method || '—' },
                {
                    label: 'Admin & Log Response',
                    value: <StatusBadge
                        status={row.admin_log_response_status}
                        variant={adminLogResponseVariant(row.admin_log_response_status)}
                    />,
                },
                {
                    label: 'RTD Signalled',
                    value: formatDate(row.ready_to_deliver_at, { withTime: true }) || '—',
                },
                { label: 'Related AWB', value: row.related_awb_id },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

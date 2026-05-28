'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { CrossDivisionContext } from '@/components/technical/CrossDivisionContext';
import { jobOrdersApi } from '@/lib/technical-api';
import { jobOrderWorkflowVariant, priorityVariant } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { TechnicalJobOrder } from '@/lib/technical-types';

export default function JobOrderDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<TechnicalJobOrder | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await jobOrdersApi.get(params.id)); }
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
                    <h2 className="text-lg font-semibold">{row.technical_job_order_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        PO {row.related_po_number || row.related_po_id || '—'} · {row.job_type}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status}
                        variant={jobOrderWorkflowVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/technical/job-orders/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <CrossDivisionContext
                relatedPoId={row.related_po_id}
                poNumber={row.related_po_number}
                poDueDate={row.po_due_date}
            />

            <DetailSection title="Planning" fields={[
                { label: 'Planned Start', value: formatDate(row.planned_start_date) },
                { label: 'Planned End', value: formatDate(row.planned_end_date) },
                { label: 'Work Duration Start', value: formatDate(row.work_duration_start) },
                { label: 'Work Duration End', value: formatDate(row.work_duration_end) },
                { label: 'PO Due Date', value: formatDate(row.po_due_date) },
                {
                    label: 'Priority',
                    value: row.priority
                        ? <StatusBadge status={row.priority} variant={priorityVariant(row.priority)} />
                        : '—',
                },
            ]} />

            <DetailSection title="Assignment" fields={[
                { label: 'Assigned Engineer', value: row.assigned_engineer_id },
                {
                    label: 'Support Team',
                    value: row.support_team_members.length > 0
                        ? row.support_team_members.join(', ') : '—',
                    span: 2,
                },
                { label: 'Customer', value: row.customer_id },
                { label: 'Current Technical Status', value: row.current_technical_status },
            ]} />

            <DetailSection title="Equipment" fields={[
                { label: 'Product / Equipment', value: row.product_or_equipment_name },
                { label: 'Serial Number', value: row.serial_number },
                { label: 'Site Location', value: row.site_location, span: 2 },
            ]} />

            <DetailSection title="Flags" fields={[
                {
                    label: '30-day PO Due Reminder',
                    value: row.due_date_reminder_flag
                        ? <StatusBadge status="Reminder active" variant="warning" />
                        : <StatusBadge status="Clear" variant="muted" />,
                },
                { label: 'Created', value: formatDate(row.created_at, { withTime: true }) },
                { label: 'Last Update', value: formatDate(row.updated_at, { withTime: true }) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

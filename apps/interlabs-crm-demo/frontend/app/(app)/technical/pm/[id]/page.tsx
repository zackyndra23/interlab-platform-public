'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { CrossDivisionContext } from '@/components/technical/CrossDivisionContext';
import { pmApi } from '@/lib/technical-api';
import { pmWorkflowVariant } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { PmRecord } from '@/lib/technical-types';

export default function PmDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<PmRecord | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await pmApi.get(params.id)); }
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
                    <h2 className="text-lg font-semibold">PM Record</h2>
                    <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={pmWorkflowVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/technical/pm/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <CrossDivisionContext relatedPoId={row.related_po_id} />

            <DetailSection title="Scheduling" fields={[
                { label: 'PM Schedule', value: formatDate(row.pm_schedule_date) },
                { label: 'PM Start', value: formatDate(row.pm_start_date) },
                { label: 'PM End', value: formatDate(row.pm_end_date) },
                { label: 'Duration Start', value: formatDate(row.work_duration_start) },
                { label: 'Duration End', value: formatDate(row.work_duration_end) },
                { label: 'Assigned Engineer', value: row.assigned_engineer_id },
            ]} />

            <DetailSection title="Activity">
                <p className="whitespace-pre-wrap text-sm">
                    {row.pm_activity_notes || <span className="text-muted-foreground">—</span>}
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

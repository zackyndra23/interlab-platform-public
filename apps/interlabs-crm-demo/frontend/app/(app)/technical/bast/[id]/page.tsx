'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { CrossDivisionContext } from '@/components/technical/CrossDivisionContext';
import { SendBastToFinancePanel } from '@/components/technical/SendBastToFinancePanel';
import { bastApi } from '@/lib/technical-api';
import { bastWorkflowVariant } from '@/lib/technical-ui';
import { formatDate } from '@/lib/utils';
import type { BastRecord } from '@/lib/technical-types';

export default function BastDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<BastRecord | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await bastApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const canSend = !row.sent_to_finance && row.workflow_status !== 'sent_to_finance';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.bast_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.job_type || '—'} · Customer PIC {row.customer_pic || '—'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={bastWorkflowVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline" disabled={!canSend}
                        onClick={() => router.push(`/technical/bast/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <CrossDivisionContext relatedPoId={row.related_po_id} />

            {canSend && <SendBastToFinancePanel bast={row} onSent={load} />}

            {row.sent_to_finance && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                    BAST sent to Finance on {formatDate(row.sent_to_finance_at, { withTime: true }) || '—'}.
                    The Invoice Customer draft has been created.
                </div>
            )}

            <DetailSection title="Completion" fields={[
                { label: 'Job Type', value: row.job_type },
                { label: 'Start', value: formatDate(row.completion_start_date) },
                { label: 'End', value: formatDate(row.completion_end_date) },
                { label: 'Commissioning', value: row.commissioning_included || '—' },
                { label: 'Training', value: row.training_included || '—' },
                { label: 'Scope Summary', value: row.scope_summary, span: 2 },
            ]} />

            <DetailSection title="Contacts" fields={[
                { label: 'Customer PIC', value: row.customer_pic },
                { label: 'Technical PIC', value: row.technical_pic_id },
                { label: 'Customer', value: row.customer_id },
                { label: 'Job Order', value: row.related_job_order_id },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { forecastsApi } from '@/lib/sales-api';
import {
    forecastStageVariant, forecastWorkflowVariant, slaVariant,
} from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { SalesForecast } from '@/lib/sales-types';

export default function ForecastDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<SalesForecast | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await forecastsApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    async function submit(): Promise<void> {
        if (!row) return;
        try {
            await forecastsApi.submit(row.id);
            toast.success('Forecast submitted');
            load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Submit failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.product_or_service_name}</h2>
                    <p className="text-xs text-muted-foreground">{row.forecast_record_number}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.stage} variant={forecastStageVariant(row.stage)} />
                    <StatusBadge status={row.workflow_status} variant={forecastWorkflowVariant(row.workflow_status)} />
                    <StatusBadge status={row.step_status} variant={slaVariant(row.step_status)} />
                    {row.workflow_status === 'draft' && (
                        <Button size="sm" onClick={submit}>
                            <Send size={14} />
                            Submit
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/sales/forecasts/${row.id}/edit`)}
                    >
                        <Pencil size={14} />
                        Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Forecast" fields={[
                { label: 'Period',
                    value: `${formatDate(row.forecast_period_start)} – ${formatDate(row.forecast_period_end)}` },
                { label: 'Expected Close', value: formatDate(row.expected_close_date) },
                { label: 'Estimated Value',
                    value: formatCurrency(row.estimated_value, row.currency) },
                { label: 'Probability',
                    value: row.probability_percent === null ? '—' : `${row.probability_percent}%` },
                { label: 'Description', value: row.description, span: 2 },
                { label: 'Notes', value: row.notes, span: 2 },
            ]} />

            <DetailSection title="SLA" fields={[
                { label: 'Current Step', value: row.current_step },
                { label: 'Due At', value: formatDate(row.step_due_at, { withTime: true }) },
                { label: 'Last Progress', value: formatDate(row.last_progress_at, { withTime: true }) },
            ]} />

            <DetailSection title="Audit" fields={[
                { label: 'Created', value: formatDate(row.created_at, { withTime: true }) },
                { label: 'Updated', value: formatDate(row.updated_at, { withTime: true }) },
            ]} />
        </div>
    );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { operationalApi } from '@/lib/admin-log-api';
import {
    expenseStatusVariant, operationalWorkflowVariant,
} from '@/lib/admin-log-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { OperationalRecord, OperationalWorkflow } from '@/lib/admin-log-types';

export default function OperationalDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<OperationalRecord | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await operationalApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    async function transition(next: OperationalWorkflow): Promise<void> {
        if (!row || next === 'draft') return;
        try {
            await operationalApi.transition(row.id, next);
            toast.success(`Moved to ${next}`);
            load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Transition failed');
        }
    }

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.operational_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.expense_category || '(uncategorised)'} · {formatDate(row.reporting_month)?.slice(0, 7)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.expense_status} variant={expenseStatusVariant(row.expense_status)} />
                    <StatusBadge status={row.workflow_status} variant={operationalWorkflowVariant(row.workflow_status)} />
                    {row.workflow_status === 'draft' && (
                        <Button size="sm" onClick={() => transition('submitted')}>
                            <Send size={14} /> Submit
                        </Button>
                    )}
                    {row.workflow_status === 'submitted' && (
                        <Button size="sm" onClick={() => transition('reviewed')}>
                            <CheckCircle2 size={14} /> Mark Reviewed
                        </Button>
                    )}
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/admin-log/operational/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Expense" fields={[
                { label: 'Reporting Month', value: formatDate(row.reporting_month)?.slice(0, 7) },
                { label: 'Department', value: row.department },
                { label: 'Category', value: row.expense_category },
                { label: 'Subcategory', value: row.expense_subcategory },
                { label: 'Transaction Date', value: formatDate(row.transaction_date) },
                {
                    label: 'Period',
                    value: `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`,
                },
                { label: 'Vendor / Payee', value: row.vendor_or_payee },
                { label: 'Related PO', value: row.related_po_id },
                { label: 'Amount', value: formatCurrency(row.amount, row.currency) },
                { label: 'Payment Method', value: row.payment_method },
                { label: 'Description', value: row.description, span: 2 },
                { label: 'Notes', value: row.notes, span: 2 },
            ]} />
        </div>
    );
}

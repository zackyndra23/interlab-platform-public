'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AttachmentList } from '@/components/shared/AttachmentList';
import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { salesPoApi } from '@/lib/sales-api';
import { salesPoVariant, slaVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { SalesPurchaseOrder } from '@/lib/sales-types';

/**
 * Sales PO detail view.
 *
 * The MOD_sales §FORM 5 "On overdue detection" rule requires the UI to
 * surface an overdue_reason input + attachment when the SLA monitor has
 * flagged the record. We render that banner whenever workflow_status is
 * 'overdue' OR step_status is 'overdue'.
 */

export default function SalesPoDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<SalesPurchaseOrder | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await salesPoApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    async function submit(): Promise<void> {
        if (!row) return;
        try { await salesPoApi.submit(row.id); toast.success('PO Registered'); load(); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Submit failed'); }
    }
    async function process(): Promise<void> {
        if (!row) return;
        try { await salesPoApi.process(row.id); toast.success('PO Processed'); load(); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Process failed'); }
    }

    const overdue = row.workflow_status === 'overdue' || row.step_status === 'overdue';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">
                        PO {row.po_number || row.po_record_number}
                    </h2>
                    <p className="text-xs text-muted-foreground">{row.po_record_number}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={salesPoVariant(row.workflow_status)} />
                    <StatusBadge status={row.step_status} variant={slaVariant(row.step_status)} />
                    {row.workflow_status === 'draft' && (
                        <Button size="sm" onClick={submit}>
                            <Send size={14} /> Submit (Register)
                        </Button>
                    )}
                    {row.workflow_status === 'submitted' && (
                        <Button size="sm" onClick={process}>
                            <CheckCircle2 size={14} /> Process
                        </Button>
                    )}
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/sales/purchase-orders/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            {overdue && <OverdueBanner po={row} onUpdated={load} />}

            <DetailSection title="Header" fields={[
                { label: 'Order Date', value: formatDate(row.order_date) },
                { label: 'Delivery Deadline', value: formatDate(row.delivery_deadline) },
                { label: 'Currency', value: row.currency },
                { label: 'Payment Terms', value: row.payment_terms },
                { label: 'Delivery Terms', value: row.delivery_terms },
                {
                    label: 'Master PO ID',
                    value: row.po_id || <span className="text-muted-foreground">not submitted</span>,
                },
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

            <DetailSection title="Totals" fields={[
                { label: 'Subtotal', value: formatCurrency(row.subtotal, row.currency) },
                { label: 'Tax', value: formatCurrency(row.tax_amount, row.currency) },
                { label: 'Total', value: formatCurrency(row.total_amount, row.currency) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>

            <DetailSection title="Attachments">
                <AttachmentList files={row.attachments ?? []} />
            </DetailSection>
        </div>
    );
}

// -------- OverdueBanner --------

function OverdueBanner({
    po, onUpdated,
}: {
    po: SalesPurchaseOrder;
    onUpdated: () => void | Promise<void>;
}) {
    const [reason, setReason] = useState(po.overdue_reason ?? '');
    const [attachmentIds, setAttachmentIds] = useState<string[]>(
        po.overdue_attachment_id ? [po.overdue_attachment_id] : [],
    );
    const [submitting, setSubmitting] = useState(false);

    async function submit(): Promise<void> {
        if (!reason.trim()) {
            toast.error('Please provide an overdue reason');
            return;
        }
        setSubmitting(true);
        try {
            await salesPoApi.overdueReason(po.id, {
                overdue_reason: reason.trim(),
                overdue_attachment_id: attachmentIds[0],
            });
            toast.success('Delay reason submitted');
            await onUpdated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Submit failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <h3 className="mb-1 text-sm font-semibold text-destructive">
                PO is overdue — reason required
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Per SLA rules, Sales must log why this PO missed its 2-working-day
                deadline. Superadmin, CEO, Admin &amp; Log, and Finance receive
                a notification once the reason is filed.
            </p>

            <FormField label="Overdue reason" name="overdue_reason" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>

            <div className="mt-3">
                <p className="mb-1 text-sm font-medium">Supporting attachment (optional)</p>
                <MultiFileUpload
                    entityModule="sales.purchase_orders.overdue"
                    entityId={po.id}
                    existingFiles={po.overdue_attachment_id
                        ? [{ id: po.overdue_attachment_id, original_filename: 'attachment', mime_type: null }]
                        : []}
                    maxFiles={1}
                    onChange={setAttachmentIds}
                />
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" variant="danger" disabled={submitting} onClick={submit}>
                    {submitting ? 'Submitting…' : 'Submit reason'}
                </Button>
            </div>
        </div>
    );
}

'use client';

import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { DatePicker } from '@/components/shared/DatePicker';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { invoiceManufacturesApi } from '@/lib/finance-api';
import type { InvoiceManufacture } from '@/lib/finance-types';

/**
 * Inline panel on the Invoice Manufacture detail page. Atomically
 * submits payment_date + payment_amount + attachment (bank proof) —
 * backend validator `invoiceManufactureUploadPayment` requires all
 * three together. Success flips payment_status → Paid and emits
 * `finance.invoice_manufacture.paid`.
 */
export function UploadPaymentPanel({
    invoice, onPaid,
}: {
    invoice: InvoiceManufacture;
    onPaid: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [paymentDate, setPaymentDate] = useState<string | null>(invoice.payment_date ?? '');
    const [paymentAmount, setPaymentAmount] = useState<number | null>(
        invoice.payment_amount ?? invoice.total_amount ?? null,
    );
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [transactionRef, setTransactionRef] = useState(invoice.transaction_reference ?? '');
    const [note, setNote] = useState('');

    async function submit(): Promise<void> {
        if (!paymentDate) { toast.error('Payment date is required'); return; }
        if (paymentAmount === null || Number.isNaN(paymentAmount) || paymentAmount < 0) {
            toast.error('Payment amount is required');
            return;
        }
        if (attachmentIds.length === 0) {
            toast.error('Attach the bank payment proof');
            return;
        }
        setSubmitting(true);
        try {
            await invoiceManufacturesApi.uploadPayment(invoice.id, {
                payment_date: paymentDate,
                payment_amount: paymentAmount,
                transaction_reference: transactionRef.trim() || null,
                attachment_ids: attachmentIds,
                note: note.trim() || null,
            });
            toast.success('Payment recorded — invoice marked Paid');
            await onPaid();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Record payment failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Wallet size={14} />
                Record Payment
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Submitting these fields together marks this manufacturer invoice
                <strong> Paid</strong> and emits the payment notification. The
                master PO stage is not changed by this action.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Payment Date" name="payment_date" required>
                    <DatePicker value={paymentDate} onChange={setPaymentDate} />
                </FormField>
                <FormField label={`Payment Amount (${invoice.currency})`} name="payment_amount" required>
                    <Input
                        type="number"
                        step="0.01"
                        value={paymentAmount ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            setPaymentAmount(v === '' ? null : Number(v));
                        }}
                    />
                </FormField>
                <FormField label="Transaction Reference" name="transaction_reference">
                    <Input
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                    />
                </FormField>
                <FormField label="Note (optional)" name="note">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>

            <div className="mt-3">
                <p className="mb-1 text-sm font-medium">Bank payment proof *</p>
                <MultiFileUpload
                    entityModule="finance.invoice_manufactures.payment"
                    entityId={invoice.id}
                    onChange={setAttachmentIds}
                    maxFiles={5}
                />
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Recording…' : 'Record Payment'}
                </Button>
            </div>
        </section>
    );
}

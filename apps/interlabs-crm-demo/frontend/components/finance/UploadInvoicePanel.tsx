'use client';

import { useState } from 'react';
import { FileCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { DatePicker } from '@/components/shared/DatePicker';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { invoiceCustomersApi } from '@/lib/finance-api';
import type { InvoiceCustomer } from '@/lib/finance-types';

/**
 * Inline panel on the Invoice Customer detail page. Atomically submits
 * invoice_number + (optional) invoice_date + invoice PDF attachment
 * per `invoiceCustomerUploadInvoice`. Success flips invoice_status →
 * Processed and advances master PO → Invoice.
 */
export function UploadInvoicePanel({
    invoice, onProcessed,
}: {
    invoice: InvoiceCustomer;
    onProcessed: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number ?? '');
    const [invoiceDate, setInvoiceDate] = useState<string | null>(invoice.invoice_date ?? '');
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [note, setNote] = useState('');

    async function submit(): Promise<void> {
        if (!invoiceNumber.trim()) {
            toast.error('Invoice number is required');
            return;
        }
        if (attachmentIds.length === 0) {
            toast.error('Attach the customer invoice document');
            return;
        }
        setSubmitting(true);
        try {
            await invoiceCustomersApi.uploadInvoice(invoice.id, {
                invoice_number: invoiceNumber.trim(),
                invoice_date: invoiceDate || undefined,
                attachment_ids: attachmentIds,
                note: note.trim() || null,
            });
            toast.success('Invoice issued — master PO advanced to Invoice');
            await onProcessed();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <FileCheck size={14} />
                Issue Customer Invoice
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Submitting invoice number + invoice document flips this record to
                <strong> Processed</strong> and advances the master PO to the
                <strong> Invoice</strong> stage. This action is irreversible.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Invoice Number" name="invoice_number" required>
                    <Input
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                    />
                </FormField>
                <FormField label="Invoice Date (optional)" name="invoice_date">
                    <DatePicker value={invoiceDate} onChange={setInvoiceDate} />
                </FormField>
                <FormField label="Note (optional)" name="note" className="md:col-span-2">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>

            <div className="mt-3">
                <p className="mb-1 text-sm font-medium">Invoice document (PDF) *</p>
                <MultiFileUpload
                    entityModule="finance.invoice_customers.invoice"
                    entityId={invoice.id}
                    onChange={setAttachmentIds}
                    maxFiles={5}
                />
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Issuing…' : 'Issue Invoice'}
                </Button>
            </div>
        </section>
    );
}

'use client';

import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { DatePicker } from '@/components/shared/DatePicker';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import type { PurchaseRequisition } from '@/lib/finance-types';

/**
 * Inline panel rendered on the PR detail page when the record is still
 * Registered. Uploads the manufacturer PO-Out bundle atomically:
 * number + date + attachment (all three required together by the
 * backend validator `requisitionUploadPoOut`). Success advances master
 * PO → Production and marks the PR → Processed.
 */
export function UploadPoOutPanel({
    pr, onProcessed,
}: {
    pr: PurchaseRequisition;
    onProcessed: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [poOutNumber, setPoOutNumber] = useState(pr.po_out_number ?? '');
    const [poOutDate, setPoOutDate] = useState<string | null>(pr.po_out_date ?? '');
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [note, setNote] = useState('');

    async function submit(): Promise<void> {
        if (!poOutNumber.trim()) {
            toast.error('PO Out number is required');
            return;
        }
        if (!poOutDate) {
            toast.error('PO Out date is required');
            return;
        }
        if (attachmentIds.length === 0) {
            toast.error('Attach the PO Out document PDF');
            return;
        }
        setSubmitting(true);
        try {
            await purchaseRequisitionsApi.uploadPoOut(pr.id, {
                po_out_number: poOutNumber.trim(),
                po_out_date: poOutDate,
                attachment_ids: attachmentIds,
                note: note.trim() || null,
            });
            toast.success('PO Out uploaded — master PO advanced to Production');
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
                <FileUp size={14} />
                Issue PO Out to Manufacturer
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Submitting these three fields together flips this PR to
                <strong> Processed</strong> and advances the master PO to
                <strong> Production</strong>. This action is irreversible.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="PO Out Number" name="po_out_number" required>
                    <Input
                        value={poOutNumber}
                        onChange={(e) => setPoOutNumber(e.target.value)}
                    />
                </FormField>
                <FormField label="PO Out Date" name="po_out_date" required>
                    <DatePicker value={poOutDate} onChange={setPoOutDate} />
                </FormField>
                <FormField label="Note (optional)" name="note" className="md:col-span-2">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>

            <div className="mt-3">
                <p className="mb-1 text-sm font-medium">PO Out document (PDF) *</p>
                <MultiFileUpload
                    entityModule="finance.purchase_requisitions.po_out"
                    entityId={pr.id}
                    onChange={setAttachmentIds}
                    maxFiles={5}
                />
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Uploading…' : 'Issue PO Out'}
                </Button>
            </div>
        </section>
    );
}

'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { inspectionQcApi } from '@/lib/technical-api';
import type {
    InspectionQcRecord, QcFinalSubmitStatus, QcReviewStatus,
} from '@/lib/technical-types';

/**
 * QC review + final-submit transition panel. Backend is forward-only:
 *   Pending Review → Reviewed → Approved, and Draft → Submitted.
 * When the new state is Approved + Submitted AND a related PO is linked,
 * the master PO advances to Inspected and technical.qc.completed fires.
 */
export function QcReviewPanel({
    qc, onUpdated,
}: {
    qc: InspectionQcRecord;
    onUpdated: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [reviewStatus, setReviewStatus] = useState<QcReviewStatus>(qc.review_status);
    const [finalStatus, setFinalStatus] = useState<QcFinalSubmitStatus>(qc.final_submit_status);
    const [note, setNote] = useState('');

    const reviewOrder: Record<QcReviewStatus, number> = {
        'Pending Review': 0, 'Reviewed': 1, 'Approved': 2,
    };
    const reviewChoices: QcReviewStatus[] = (['Pending Review', 'Reviewed', 'Approved'] as const)
        .filter((s) => reviewOrder[s] >= reviewOrder[qc.review_status]);

    async function submit(): Promise<void> {
        setSubmitting(true);
        try {
            await inspectionQcApi.submitReview(qc.id, {
                review_status: reviewStatus,
                final_submit_status: finalStatus,
                note: note.trim() || null,
            });
            toast.success(
                reviewStatus === 'Approved' && finalStatus === 'Submitted'
                    ? 'QC approved & submitted — PO advanced to Inspected'
                    : 'QC review updated',
            );
            await onUpdated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setSubmitting(false);
        }
    }

    if (qc.final_submit_status === 'Submitted') return null;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 size={14} />
                Submit QC Review
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Forward-only. Setting Review=Approved + Final=Submitted and a
                related PO advances the master PO to <strong>Inspected</strong>.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Review Status" name="review_status">
                    <select
                        value={reviewStatus}
                        onChange={(e) => setReviewStatus(e.target.value as QcReviewStatus)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {reviewChoices.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="Final Submit" name="final_submit_status">
                    <select
                        value={finalStatus}
                        onChange={(e) => setFinalStatus(e.target.value as QcFinalSubmitStatus)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="Draft">Draft</option>
                        <option value="Submitted">Submitted</option>
                    </select>
                </FormField>
                <FormField label="Note (optional)" name="note" className="md:col-span-2">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Saving…' : 'Update Review'}
                </Button>
            </div>
        </section>
    );
}

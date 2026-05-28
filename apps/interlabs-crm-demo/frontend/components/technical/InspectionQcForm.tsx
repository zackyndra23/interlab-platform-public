'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { inspectionQcApi } from '@/lib/technical-api';
import type {
    DefectCategory, InspectionQcCreateInput, InspectionQcRecord,
    ItemCondition, QcFinalSubmitStatus, QcResult, QcReviewStatus,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Inspection & QC form. Forward-only review transitions (Pending Review
 * → Reviewed → Approved) are handled via the dedicated /submit-review
 * panel on the detail page; this form captures the inspection data and
 * draft state only.
 */

const itemConditions: ItemCondition[] = ['Good', 'Incomplete', 'Damaged'];
const defectCategories: DefectCategory[] = ['None', 'Physical', 'Functional', 'Documentation'];
const qcResults: QcResult[] = ['Pass', 'Need Fix', 'Reject'];
const reviewStatuses: QcReviewStatus[] = ['Pending Review', 'Reviewed', 'Approved'];
const finalStatuses: QcFinalSubmitStatus[] = ['Draft', 'Submitted'];

const schema = z.object({
    related_job_order_id: z.string().uuid().nullable(),
    related_po_id: z.string().uuid().nullable(),
    item_or_equipment_name: z.string().max(500).nullable().optional(),
    item_condition: z.enum(itemConditions as [ItemCondition, ...ItemCondition[]]).nullable().optional().or(z.literal('')),
    defect_category: z.enum(defectCategories as [DefectCategory, ...DefectCategory[]]),
    defect_description: z.string().nullable().optional(),
    pic_user_id: z.string().uuid().nullable(),
    qc_result: z.enum(qcResults as [QcResult, ...QcResult[]]).nullable().optional().or(z.literal('')),
    review_status: z.enum(reviewStatuses as [QcReviewStatus, ...QcReviewStatus[]]),
    final_submit_status: z.enum(finalStatuses as [QcFinalSubmitStatus, ...QcFinalSubmitStatus[]]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: InspectionQcRecord): FormValues {
    return {
        related_job_order_id: existing?.related_job_order_id ?? null,
        related_po_id: existing?.related_po_id ?? null,
        item_or_equipment_name: existing?.item_or_equipment_name ?? '',
        item_condition: existing?.item_condition ?? null,
        defect_category: existing?.defect_category ?? 'None',
        defect_description: existing?.defect_description ?? '',
        pic_user_id: existing?.pic_user_id ?? null,
        qc_result: existing?.qc_result ?? null,
        review_status: existing?.review_status ?? 'Pending Review',
        final_submit_status: existing?.final_submit_status ?? 'Draft',
        notes: existing?.notes ?? '',
    };
}

export function InspectionQcForm({ existing }: { existing?: InspectionQcRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'technical.inspection_qc',
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);
    const isSubmitted = existing?.final_submit_status === 'Submitted';

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const payload: InspectionQcCreateInput = {
                related_job_order_id: parsed.data.related_job_order_id,
                related_po_id: parsed.data.related_po_id,
                item_or_equipment_name: parsed.data.item_or_equipment_name || null,
                item_condition:
                    (parsed.data.item_condition as ItemCondition | null | '') || null,
                defect_category: parsed.data.defect_category,
                defect_description: parsed.data.defect_description || null,
                pic_user_id: parsed.data.pic_user_id,
                qc_result:
                    (parsed.data.qc_result as QcResult | null | '') || null,
                review_status: parsed.data.review_status,
                final_submit_status: parsed.data.final_submit_status,
                notes: parsed.data.notes || null,
                attachment_qc_file_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await inspectionQcApi.update(existing.id, payload);
                toast.success('QC record updated');
            } else {
                await inspectionQcApi.create(payload);
                toast.success('QC record created');
            }
            draft.clearDraft();
            router.replace('/technical/inspection-qc');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {draft.hasDraft && !bannerSeen && (
                <DraftBanner
                    onResume={() => {
                        const d = draft.loadDraft();
                        if (d) form.reset(d);
                        setBannerSeen(true);
                    }}
                    onDiscard={() => { draft.clearDraft(); setBannerSeen(true); }}
                />
            )}

            {isSubmitted && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    This QC is <strong>Submitted</strong> and locked. Reviews and
                    state transitions are disabled.
                </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Related Job Order" name="related_job_order_id">
                    <Controller
                        name="related_job_order_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/technical/job-orders"
                                labelKey="technical_job_order_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Related PO" name="related_po_id">
                    <Controller
                        name="related_po_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/purchase-orders"
                                labelKey="po_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Item / Equipment" name="item_or_equipment_name">
                    <Input {...form.register('item_or_equipment_name')} />
                </FormField>
                <FormField label="Item Condition" name="item_condition">
                    <select
                        {...form.register('item_condition')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {itemConditions.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField label="Defect Category" name="defect_category">
                    <select
                        {...form.register('defect_category')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {defectCategories.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField label="PIC" name="pic_user_id">
                    <Controller
                        name="pic_user_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/users"
                                labelKey="display_name"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="QC Result" name="qc_result">
                    <select
                        {...form.register('qc_result')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {qcResults.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField
                    label="Review Status" name="review_status"
                    hint="Forward transitions happen via the Submit Review panel."
                >
                    <select
                        {...form.register('review_status')}
                        disabled
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                    >
                        {reviewStatuses.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField
                    label="Final Submit" name="final_submit_status"
                    hint="Flipped by the Submit Review panel."
                >
                    <select
                        {...form.register('final_submit_status')}
                        disabled
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                    >
                        {finalStatuses.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
            </div>

            <FormField
                label="Defect Description" name="defect_description"
                hint="Required when defect category is not None."
            >
                <textarea
                    rows={2}
                    {...form.register('defect_description')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">QC Attachments</p>
                <MultiFileUpload
                    entityModule="technical.inspection_qc"
                    entityId={existing?.id}
                    onChange={setAttachmentIds}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Create'}
                submitting={submitting || isSubmitted}
            />
        </form>
    );
}

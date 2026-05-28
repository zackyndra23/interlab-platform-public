'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { DatePicker } from '@/components/shared/DatePicker';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { bastApi } from '@/lib/technical-api';
import type {
    BastCreateInput, BastRecord, BastWorkflow, JobType, YesNo,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * BAST (Berita Acara Serah Terima) form. Edits save draft/submitted state
 * only. The actual Finance handoff is done via a dedicated "Send to
 * Finance" action on the detail page that calls /bast/:id/send-to-finance,
 * which creates the Invoice Customer draft + advances the master PO to
 * BAST in one transaction.
 */

const jobTypes: JobType[] = ['Installation', 'PM', 'Sparepart'];
/**
 * `sent_to_finance` is deliberately excluded — that terminal state is owned
 * by the dedicated SendBastToFinancePanel which calls
 * PUT /bast/:id/send-to-finance atomically (creates Invoice Customer draft
 * + advances master PO → BAST). Letting the user pick it from a plain
 * dropdown would strand the record: `workflow_status='sent_to_finance'`
 * without `sent_to_finance=true`, no invoice draft, and the detail-page
 * Send panel would then hide itself because `workflow_status !== 'sent_to_finance'`
 * is false.
 */
type ManualBastWorkflow = Exclude<BastWorkflow, 'sent_to_finance'>;
const manualWorkflows: ManualBastWorkflow[] = ['draft', 'submitted'];
const yesNo: YesNo[] = ['Yes', 'No'];

const schema = z.object({
    related_job_order_id: z.string().uuid().nullable(),
    related_po_id: z.string().uuid().nullable(),
    customer_id: z.string().uuid().nullable(),
    job_type: z.enum(jobTypes as [JobType, ...JobType[]]).nullable().optional().or(z.literal('')),
    completion_start_date: z.string().nullable().optional(),
    completion_end_date: z.string().nullable().optional(),
    scope_summary: z.string().nullable().optional(),
    commissioning_included: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    training_included: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    customer_pic: z.string().max(500).nullable().optional(),
    technical_pic_id: z.string().uuid().nullable(),
    workflow_status: z.enum(manualWorkflows as [ManualBastWorkflow, ...ManualBastWorkflow[]]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: BastRecord): FormValues {
    // If existing is already 'sent_to_finance' the form is rendered in the
    // locked/isSent state (submit disabled), so clamping the default to a
    // manual-only value keeps the <select> controlled without letting the
    // terminal state appear as a user-pickable option.
    const existingManual: ManualBastWorkflow =
        existing?.workflow_status === 'submitted' ? 'submitted' : 'draft';
    return {
        related_job_order_id: existing?.related_job_order_id ?? null,
        related_po_id: existing?.related_po_id ?? null,
        customer_id: existing?.customer_id ?? null,
        job_type: existing?.job_type ?? null,
        completion_start_date: existing?.completion_start_date ?? '',
        completion_end_date: existing?.completion_end_date ?? '',
        scope_summary: existing?.scope_summary ?? '',
        commissioning_included: existing?.commissioning_included ?? null,
        training_included: existing?.training_included ?? null,
        customer_pic: existing?.customer_pic ?? '',
        technical_pic_id: existing?.technical_pic_id ?? null,
        workflow_status: existingManual,
        notes: existing?.notes ?? '',
    };
}

export function BastForm({ existing }: { existing?: BastRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [bastFileIds, setBastFileIds] = useState<string[]>([]);
    const [serviceReportFileIds, setServiceReportFileIds] = useState<string[]>([]);
    const [testResultFileIds, setTestResultFileIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'technical.bast',
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);
    const isSent = existing?.workflow_status === 'sent_to_finance';

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const payload: BastCreateInput = {
                related_job_order_id: parsed.data.related_job_order_id,
                related_po_id: parsed.data.related_po_id,
                customer_id: parsed.data.customer_id,
                job_type: (parsed.data.job_type as JobType | null | '') || null,
                completion_start_date: parsed.data.completion_start_date || null,
                completion_end_date: parsed.data.completion_end_date || null,
                scope_summary: parsed.data.scope_summary || null,
                commissioning_included:
                    (parsed.data.commissioning_included as YesNo | null | '') || null,
                training_included:
                    (parsed.data.training_included as YesNo | null | '') || null,
                customer_pic: parsed.data.customer_pic || null,
                technical_pic_id: parsed.data.technical_pic_id,
                workflow_status: parsed.data.workflow_status,
                notes: parsed.data.notes || null,
                attachment_bast_file_ids:
                    bastFileIds.length > 0 ? bastFileIds : undefined,
                attachment_service_report_file_ids:
                    serviceReportFileIds.length > 0 ? serviceReportFileIds : undefined,
                attachment_test_result_file_ids:
                    testResultFileIds.length > 0 ? testResultFileIds : undefined,
            };
            if (existing) {
                await bastApi.update(existing.id, payload);
                toast.success('BAST updated');
            } else {
                await bastApi.create(payload);
                toast.success('BAST created');
            }
            draft.clearDraft();
            router.replace('/technical/bast');
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

            {isSent && (
                <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
                    Sent to Finance. Record is locked.
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
                <FormField label="Customer" name="customer_id">
                    <Controller
                        name="customer_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/customers"
                                labelKey="company_name"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Job Type" name="job_type">
                    <select
                        {...form.register('job_type')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {jobTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                </FormField>

                <FormField label="Completion Start" name="completion_start_date">
                    <Controller
                        name="completion_start_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Completion End" name="completion_end_date">
                    <Controller
                        name="completion_end_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>

                <FormField label="Customer PIC" name="customer_pic">
                    <Input {...form.register('customer_pic')} />
                </FormField>
                <FormField label="Technical PIC" name="technical_pic_id">
                    <Controller
                        name="technical_pic_id"
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

                <FormField label="Commissioning Included" name="commissioning_included">
                    <select
                        {...form.register('commissioning_included')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {yesNo.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField label="Training Included" name="training_included">
                    <select
                        {...form.register('training_included')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {yesNo.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField
                    label="Workflow Status" name="workflow_status"
                    hint="Move to sent_to_finance only via the Send to Finance action on the detail page."
                >
                    <select
                        {...form.register('workflow_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {manualWorkflows.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                </FormField>
            </div>

            <FormField label="Scope Summary" name="scope_summary">
                <textarea
                    rows={3}
                    {...form.register('scope_summary')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div className="grid gap-4 md:grid-cols-3">
                <div>
                    <p className="mb-1 text-sm font-medium">BAST Documents</p>
                    <MultiFileUpload
                        entityModule="technical.bast"
                        entityId={existing?.id}
                        onChange={setBastFileIds}
                    />
                </div>
                <div>
                    <p className="mb-1 text-sm font-medium">Service Reports</p>
                    <MultiFileUpload
                        entityModule="technical.bast_service_report"
                        entityId={existing?.id}
                        onChange={setServiceReportFileIds}
                    />
                </div>
                <div>
                    <p className="mb-1 text-sm font-medium">Test Results</p>
                    <MultiFileUpload
                        entityModule="technical.bast_test_result"
                        entityId={existing?.id}
                        onChange={setTestResultFileIds}
                    />
                </div>
            </div>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Create'}
                submitting={submitting || isSent}
            />
        </form>
    );
}

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
import { useFormDraft } from '@/hooks/useFormDraft';
import { pmApi } from '@/lib/technical-api';
import type {
    PmCreateInput, PmRecord, PmWorkflow,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * PM (Preventive Maintenance) form. Uploading BASTP files triggers the
 * BAST→Invoice Customer handoff identically to Installation.bast_upload_file_ids.
 */

const workflows: PmWorkflow[] = ['scheduled', 'in_progress', 'completed'];

const schema = z.object({
    related_job_order_id: z.string().uuid('Select the Job Order'),
    related_po_id: z.string().uuid().nullable(),
    assigned_engineer_id: z.string().uuid().nullable(),
    pm_schedule_date: z.string().nullable().optional(),
    pm_start_date: z.string().nullable().optional(),
    pm_end_date: z.string().nullable().optional(),
    work_duration_start: z.string().nullable().optional(),
    work_duration_end: z.string().nullable().optional(),
    pm_activity_notes: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    workflow_status: z.enum(workflows as [PmWorkflow, ...PmWorkflow[]]),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: PmRecord): FormValues {
    return {
        related_job_order_id: existing?.related_job_order_id ?? '',
        related_po_id: existing?.related_po_id ?? null,
        assigned_engineer_id: existing?.assigned_engineer_id ?? null,
        pm_schedule_date: existing?.pm_schedule_date ?? '',
        pm_start_date: existing?.pm_start_date ?? '',
        pm_end_date: existing?.pm_end_date ?? '',
        work_duration_start: existing?.work_duration_start ?? '',
        work_duration_end: existing?.work_duration_end ?? '',
        pm_activity_notes: existing?.pm_activity_notes ?? '',
        notes: existing?.notes ?? '',
        workflow_status: existing?.workflow_status ?? 'scheduled',
    };
}

export function PmForm({ existing }: { existing?: PmRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [serviceReportIds, setServiceReportIds] = useState<string[]>([]);
    const [bastpIds, setBastpIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'technical.pm',
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const payload: PmCreateInput = {
                related_job_order_id: parsed.data.related_job_order_id,
                related_po_id: parsed.data.related_po_id,
                assigned_engineer_id: parsed.data.assigned_engineer_id,
                pm_schedule_date: parsed.data.pm_schedule_date || null,
                pm_start_date: parsed.data.pm_start_date || null,
                pm_end_date: parsed.data.pm_end_date || null,
                work_duration_start: parsed.data.work_duration_start || null,
                work_duration_end: parsed.data.work_duration_end || null,
                pm_activity_notes: parsed.data.pm_activity_notes || null,
                notes: parsed.data.notes || null,
                workflow_status: parsed.data.workflow_status,
                service_report_file_ids: serviceReportIds.length > 0 ? serviceReportIds : undefined,
                bastp_file_ids: bastpIds.length > 0 ? bastpIds : undefined,
            };
            if (existing) {
                await pmApi.update(existing.id, payload);
                toast.success('PM updated');
            } else {
                await pmApi.create(payload);
                toast.success('PM created');
            }
            draft.clearDraft();
            router.replace('/technical/pm');
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

            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                Uploading BASTP completion documents auto-creates the Finance Invoice
                Customer draft and advances the PO to <strong>BAST</strong>. The
                PM record is then locked as <strong>completed</strong>.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField
                    label="Related Job Order" name="related_job_order_id" required
                    error={form.formState.errors.related_job_order_id?.message}
                >
                    <Controller
                        name="related_job_order_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/technical/job-orders"
                                labelKey="technical_job_order_number"
                                value={field.value || null}
                                onChange={(v) => field.onChange(v || '')}
                                disabled={!!existing}
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
                <FormField label="Assigned Engineer" name="assigned_engineer_id">
                    <Controller
                        name="assigned_engineer_id"
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
                <FormField label="Workflow Status" name="workflow_status">
                    <select
                        {...form.register('workflow_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {workflows.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                </FormField>

                <FormField label="Schedule Date" name="pm_schedule_date">
                    <Controller
                        name="pm_schedule_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Start Date" name="pm_start_date">
                    <Controller
                        name="pm_start_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="End Date" name="pm_end_date">
                    <Controller
                        name="pm_end_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Work Duration — Start" name="work_duration_start">
                    <Controller
                        name="work_duration_start"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Work Duration — End" name="work_duration_end">
                    <Controller
                        name="work_duration_end"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
            </div>

            <FormField label="PM Activity Notes" name="pm_activity_notes">
                <textarea
                    rows={3}
                    {...form.register('pm_activity_notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Service Report Files</p>
                <MultiFileUpload
                    entityModule="technical.pm_service_report"
                    entityId={existing?.id}
                    onChange={setServiceReportIds}
                />
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">BASTP (Berita Acara Serah Terima Pekerjaan)</p>
                <MultiFileUpload
                    entityModule="technical.pm_bastp"
                    entityId={existing?.id}
                    onChange={setBastpIds}
                />
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
                submitting={submitting}
            />
        </form>
    );
}

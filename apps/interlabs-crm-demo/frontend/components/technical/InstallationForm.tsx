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
import { installationsApi } from '@/lib/technical-api';
import type {
    DeliveryMethod, DocumentCompletenessStatus, FunctionTestStatus,
    InspectionStatus, InstallationCreateInput, InstallationRecord,
    InstallationWorkflowPhase, PreInstallationStatus, WorkshopCheckStatus,
    YesNo,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Installation create/edit form. This screen owns three of the four server-
 * side triggers (the RTD button gets its own dedicated action):
 *   1. inspection_status=Complete + function_test_status=Pass → PO Inspected
 *   2. installation_start_date first populated → PO Installation
 *   3. bast_upload_file_ids uploaded → materializes BAST + Invoice Customer
 *      draft in Finance + PO → BAST
 *
 * A yellow banner spells out the automation so the Technical user knows
 * which field writes will fire cross-division handoffs.
 */

const phases: InstallationWorkflowPhase[] = [
    'pre_installation', 'workshop', 'ready_to_deliver',
    'scheduling', 'on_site', 'commissioning', 'completed',
];
const preStatuses: PreInstallationStatus[] = ['Pending', 'In Progress', 'Complete'];
const workshopStatuses: WorkshopCheckStatus[] = ['Pending', 'In Progress', 'Passed', 'Failed'];
const inspectionStatuses: InspectionStatus[] = ['Pending', 'In Progress', 'Complete'];
const functionTestStatuses: FunctionTestStatus[] = ['Pending', 'Pass', 'Fail'];
const documentStatuses: DocumentCompletenessStatus[] = ['Complete', 'Incomplete'];
const yesNo: YesNo[] = ['Yes', 'No'];
const deliveryMethods: DeliveryMethod[] = ['Pick Up Forwarder', 'Hand Carry'];

const schema = z.object({
    related_job_order_id: z.string().uuid('Select the Job Order'),
    related_po_id: z.string().uuid().nullable(),
    pre_installation_status: z.enum(preStatuses as [PreInstallationStatus, ...PreInstallationStatus[]]),
    local_part_request_needed: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    local_part_request_reference: z.string().max(500).nullable().optional(),
    finance_local_part_status: z.string().max(200).nullable().optional(),
    workshop_check_status: z.enum(workshopStatuses as [WorkshopCheckStatus, ...WorkshopCheckStatus[]]),
    inspection_status: z.enum(inspectionStatuses as [InspectionStatus, ...InspectionStatus[]]),
    document_completeness_status: z.enum(documentStatuses as [DocumentCompletenessStatus, ...DocumentCompletenessStatus[]]).nullable().optional().or(z.literal('')),
    function_test_status: z.enum(functionTestStatuses as [FunctionTestStatus, ...FunctionTestStatus[]]),
    ready_to_deliver: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    delivery_method: z.enum(deliveryMethods as [DeliveryMethod, ...DeliveryMethod[]]).nullable().optional().or(z.literal('')),
    installation_schedule_date: z.string().nullable().optional(),
    installation_start_date: z.string().nullable().optional(),
    installation_end_date: z.string().nullable().optional(),
    commissioning_included: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    training_included: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    workflow_phase: z.enum(phases as [InstallationWorkflowPhase, ...InstallationWorkflowPhase[]]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: InstallationRecord): FormValues {
    return {
        related_job_order_id: existing?.related_job_order_id ?? '',
        related_po_id: existing?.related_po_id ?? null,
        pre_installation_status: existing?.pre_installation_status ?? 'Pending',
        local_part_request_needed: existing?.local_part_request_needed ?? null,
        local_part_request_reference: existing?.local_part_request_reference ?? '',
        finance_local_part_status: existing?.finance_local_part_status ?? '',
        workshop_check_status: existing?.workshop_check_status ?? 'Pending',
        inspection_status: existing?.inspection_status ?? 'Pending',
        document_completeness_status: existing?.document_completeness_status ?? null,
        function_test_status: existing?.function_test_status ?? 'Pending',
        ready_to_deliver: existing?.ready_to_deliver ?? null,
        delivery_method: existing?.delivery_method ?? null,
        installation_schedule_date: existing?.installation_schedule_date ?? '',
        installation_start_date: existing?.installation_start_date ?? '',
        installation_end_date: existing?.installation_end_date ?? '',
        commissioning_included: existing?.commissioning_included ?? null,
        training_included: existing?.training_included ?? null,
        workflow_phase: existing?.workflow_phase ?? 'pre_installation',
        notes: existing?.notes ?? '',
    };
}

export function InstallationForm({ existing }: { existing?: InstallationRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [qcFormFileIds, setQcFormFileIds] = useState<string[]>([]);
    const [bastFileIds, setBastFileIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'technical.installation',
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
            const payload: InstallationCreateInput = {
                related_job_order_id: parsed.data.related_job_order_id,
                related_po_id: parsed.data.related_po_id,
                pre_installation_status: parsed.data.pre_installation_status,
                local_part_request_needed:
                    (parsed.data.local_part_request_needed as YesNo | null | '') || null,
                local_part_request_reference: parsed.data.local_part_request_reference || null,
                finance_local_part_status: parsed.data.finance_local_part_status || null,
                workshop_check_status: parsed.data.workshop_check_status,
                inspection_status: parsed.data.inspection_status,
                document_completeness_status:
                    (parsed.data.document_completeness_status as DocumentCompletenessStatus | null | '') || null,
                function_test_status: parsed.data.function_test_status,
                ready_to_deliver:
                    (parsed.data.ready_to_deliver as YesNo | null | '') || null,
                delivery_method:
                    (parsed.data.delivery_method as DeliveryMethod | null | '') || null,
                installation_schedule_date: parsed.data.installation_schedule_date || null,
                installation_start_date: parsed.data.installation_start_date || null,
                installation_end_date: parsed.data.installation_end_date || null,
                commissioning_included:
                    (parsed.data.commissioning_included as YesNo | null | '') || null,
                training_included:
                    (parsed.data.training_included as YesNo | null | '') || null,
                workflow_phase: parsed.data.workflow_phase,
                notes: parsed.data.notes || null,
                qc_form_file_ids: qcFormFileIds.length > 0 ? qcFormFileIds : undefined,
                bast_upload_file_ids: bastFileIds.length > 0 ? bastFileIds : undefined,
            };
            if (existing) {
                await installationsApi.update(existing.id, payload);
                toast.success('Installation updated');
            } else {
                await installationsApi.create(payload);
                toast.success('Installation created');
            }
            draft.clearDraft();
            router.replace('/technical/installations');
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
                Saving this installation triggers PO automation:
                Inspection=Complete + Function Test=Pass → <strong>Inspected</strong>;
                first installation start date → <strong>Installation</strong>;
                uploading BAST files → creates Finance invoice draft + <strong>BAST</strong>.
                Use the Ready-to-Deliver button on the detail page to start the 2-day Admin &amp; Log SLA.
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
            </div>

            <fieldset className="rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    Pre-Installation
                </legend>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Pre-Installation Status" name="pre_installation_status">
                        <select
                            {...form.register('pre_installation_status')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {preStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Local Part Request Needed" name="local_part_request_needed">
                        <select
                            {...form.register('local_part_request_needed')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">—</option>
                            {yesNo.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Local Part Request Reference" name="local_part_request_reference">
                        <Input {...form.register('local_part_request_reference')} />
                    </FormField>
                    <FormField
                        label="Finance Local Part Status (read-only)" name="finance_local_part_status"
                        hint="Surfaced from Finance PR records."
                    >
                        <Input {...form.register('finance_local_part_status')} />
                    </FormField>
                </div>
            </fieldset>

            <fieldset className="rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    Workshop &amp; Inspection
                </legend>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Workshop Check" name="workshop_check_status">
                        <select
                            {...form.register('workshop_check_status')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {workshopStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </FormField>
                    <FormField
                        label="Inspection Status" name="inspection_status"
                        hint="Complete + Function Test=Pass advances PO → Inspected."
                    >
                        <select
                            {...form.register('inspection_status')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {inspectionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Document Completeness" name="document_completeness_status">
                        <select
                            {...form.register('document_completeness_status')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">—</option>
                            {documentStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Function Test" name="function_test_status">
                        <select
                            {...form.register('function_test_status')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {functionTestStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </FormField>
                </div>
                <div className="mt-3">
                    <p className="mb-1 text-sm font-medium">QC Form Documents</p>
                    <MultiFileUpload
                        entityModule="technical.installation_qc"
                        entityId={existing?.id}
                        onChange={setQcFormFileIds}
                    />
                </div>
            </fieldset>

            <fieldset className="rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    Installation Phase
                </legend>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Schedule Date" name="installation_schedule_date">
                        <Controller
                            name="installation_schedule_date"
                            control={form.control}
                            render={({ field }) => (
                                <DatePicker value={field.value} onChange={field.onChange} />
                            )}
                        />
                    </FormField>
                    <FormField
                        label="Start Date" name="installation_start_date"
                        hint="First non-null save advances PO → Installation."
                    >
                        <Controller
                            name="installation_start_date"
                            control={form.control}
                            render={({ field }) => (
                                <DatePicker value={field.value} onChange={field.onChange} />
                            )}
                        />
                    </FormField>
                    <FormField label="End Date" name="installation_end_date">
                        <Controller
                            name="installation_end_date"
                            control={form.control}
                            render={({ field }) => (
                                <DatePicker value={field.value} onChange={field.onChange} />
                            )}
                        />
                    </FormField>
                    <FormField label="Workflow Phase" name="workflow_phase">
                        <select
                            {...form.register('workflow_phase')}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
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
                </div>
            </fieldset>

            <fieldset className="rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    BAST Upload
                </legend>
                <p className="mb-2 text-xs text-muted-foreground">
                    Uploading here auto-creates a BAST record, Finance Invoice Customer
                    draft, and advances the PO to BAST. Prefer the dedicated BAST form
                    for fully-documented handoffs.
                </p>
                <MultiFileUpload
                    entityModule="technical.installation_bast"
                    entityId={existing?.id}
                    onChange={setBastFileIds}
                />
            </fieldset>

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

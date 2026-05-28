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
import { jobOrdersApi } from '@/lib/technical-api';
import type {
    JobType, JobOrderWorkflow, Priority,
    TechnicalJobOrder, TechnicalJobOrderInput,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Technical Job Order create/edit form. `related_po_id` and `job_type`
 * are required on create (see backend jobOrderCreate validator). On edit,
 * the same fields remain editable but the backend treats them as optional
 * COALESCE updates.
 *
 * Customer + PO due date are auto-derived server-side from the linked PO
 * when left blank; the form exposes them so the user can override.
 */

const jobTypes: JobType[] = ['Installation', 'PM', 'Sparepart'];
const priorities: Priority[] = ['Low', 'Medium', 'High', 'Critical'];
const workflows: JobOrderWorkflow[] = ['draft', 'active', 'completed', 'cancelled'];

const schema = z.object({
    related_po_id: z.string().uuid('Select the related PO'),
    job_type: z.enum(jobTypes as [JobType, ...JobType[]]),
    customer_id: z.string().uuid().nullable(),
    planned_start_date: z.string().nullable().optional(),
    planned_end_date: z.string().nullable().optional(),
    work_duration_start: z.string().nullable().optional(),
    work_duration_end: z.string().nullable().optional(),
    assigned_engineer_id: z.string().uuid().nullable(),
    site_location: z.string().nullable().optional(),
    product_or_equipment_name: z.string().max(500).nullable().optional(),
    serial_number: z.string().max(200).nullable().optional(),
    priority: z.enum(priorities as [Priority, ...Priority[]]).nullable().optional().or(z.literal('')),
    current_technical_status: z.string().max(200).nullable().optional(),
    po_due_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    workflow_status: z.enum(workflows as [JobOrderWorkflow, ...JobOrderWorkflow[]]),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: TechnicalJobOrder): FormValues {
    return {
        related_po_id: existing?.related_po_id ?? '',
        job_type: (existing?.job_type as JobType) ?? 'Installation',
        customer_id: existing?.customer_id ?? null,
        planned_start_date: existing?.planned_start_date ?? '',
        planned_end_date: existing?.planned_end_date ?? '',
        work_duration_start: existing?.work_duration_start ?? '',
        work_duration_end: existing?.work_duration_end ?? '',
        assigned_engineer_id: existing?.assigned_engineer_id ?? null,
        site_location: existing?.site_location ?? '',
        product_or_equipment_name: existing?.product_or_equipment_name ?? '',
        serial_number: existing?.serial_number ?? '',
        priority: existing?.priority ?? null,
        current_technical_status: existing?.current_technical_status ?? '',
        po_due_date: existing?.po_due_date ?? '',
        notes: existing?.notes ?? '',
        workflow_status: existing?.workflow_status ?? 'draft',
    };
}

export function JobOrderForm({ existing }: { existing?: TechnicalJobOrder }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [supportTeam, setSupportTeam] = useState<string[]>(existing?.support_team_members ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; team: string[] }>({
        formKey: 'technical.job_order',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, team: supportTeam },
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
            const payload: TechnicalJobOrderInput = {
                ...parsed.data,
                priority: (parsed.data.priority as Priority | null | '') || null,
                related_po_number: null,
                support_team_members: supportTeam,
                planned_start_date: parsed.data.planned_start_date || null,
                planned_end_date: parsed.data.planned_end_date || null,
                work_duration_start: parsed.data.work_duration_start || null,
                work_duration_end: parsed.data.work_duration_end || null,
                po_due_date: parsed.data.po_due_date || null,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await jobOrdersApi.update(existing.id, payload);
                toast.success('Job Order updated');
            } else {
                await jobOrdersApi.create(payload);
                toast.success('Job Order created');
            }
            draft.clearDraft();
            router.replace('/technical/job-orders');
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
                        if (d) { form.reset(d.form); setSupportTeam(d.team); }
                        setBannerSeen(true);
                    }}
                    onDiscard={() => { draft.clearDraft(); setBannerSeen(true); }}
                />
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <FormField
                    label="Related PO" name="related_po_id" required
                    error={form.formState.errors.related_po_id?.message}
                    hint="Customer + PO due date copy from this PO if blank."
                >
                    <Controller
                        name="related_po_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/purchase-orders"
                                labelKey="po_record_number"
                                value={field.value || null}
                                onChange={(v) => field.onChange(v || '')}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Job Type" name="job_type" required>
                    <select
                        {...form.register('job_type')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {jobTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
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

                <FormField label="Planned Start" name="planned_start_date">
                    <Controller
                        name="planned_start_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Planned End" name="planned_end_date">
                    <Controller
                        name="planned_end_date"
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

                <FormField
                    label="PO Due Date" name="po_due_date"
                    hint="30-day reminder flag is set automatically by the SLA job."
                >
                    <Controller
                        name="po_due_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>

                <FormField label="Priority" name="priority">
                    <select
                        {...form.register('priority')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                </FormField>

                <FormField label="Product / Equipment" name="product_or_equipment_name">
                    <Input {...form.register('product_or_equipment_name')} />
                </FormField>
                <FormField label="Serial Number" name="serial_number">
                    <Input {...form.register('serial_number')} />
                </FormField>

                <FormField label="Current Technical Status" name="current_technical_status">
                    <Input {...form.register('current_technical_status')} />
                </FormField>
                <FormField label="Workflow Status" name="workflow_status">
                    <select
                        {...form.register('workflow_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {workflows.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                </FormField>
            </div>

            <FormField label="Site Location" name="site_location">
                <textarea
                    rows={2}
                    {...form.register('site_location')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <FormField
                label="Support Team Members" name="support_team_members"
                hint="Adds technicians as notification recipients on this Job Order."
            >
                <SupportTeamEditor value={supportTeam} onChange={setSupportTeam} />
            </FormField>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Supporting Attachments</p>
                <MultiFileUpload
                    entityModule="technical.job_orders"
                    entityId={existing?.id}
                    onChange={setAttachmentIds}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Create'}
                submitting={submitting}
            />
        </form>
    );
}

function SupportTeamEditor({
    value, onChange,
}: { value: string[]; onChange: (v: string[]) => void }) {
    const [picker, setPicker] = useState<string | null>(null);
    function addMember(id: string | null): void {
        if (!id) return;
        if (!value.includes(id)) onChange([...value, id]);
        setPicker(null);
    }
    return (
        <div className="space-y-2">
            <SearchDropdown
                endpoint="/api/users"
                labelKey="display_name"
                value={picker}
                onChange={addMember}
                placeholder="Add technician…"
            />
            {value.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {value.map((id) => (
                        <li key={id} className="flex items-center justify-between px-3 py-2">
                            <span className="font-mono text-xs text-muted-foreground">{id}</span>
                            <button
                                type="button"
                                onClick={() => onChange(value.filter((v) => v !== id))}
                                className="text-xs text-destructive hover:underline"
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

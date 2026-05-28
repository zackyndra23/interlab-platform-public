'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { useFormDraft } from '@/hooks/useFormDraft';
import { sparepartsApi } from '@/lib/technical-api';
import type {
    DeliveryMethod, SparepartCreateInput, SparepartRecord,
    SparepartWorkflow, WorkshopCheckStatus, YesNo,
} from '@/lib/technical-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Sparepart create/edit form. Setting ready_to_deliver=Yes starts the
 * 2-working-day Admin & Log response SLA (same trigger semantics as
 * Installation). Billing support files trigger a Finance handoff
 * notification (no PO-stage change).
 */

const workflows: SparepartWorkflow[] = ['awaiting_awb', 'workshop_check', 'ready', 'dispatched'];
const workshopStatuses: WorkshopCheckStatus[] = ['Pending', 'In Progress', 'Passed', 'Failed'];
const yesNo: YesNo[] = ['Yes', 'No'];
const deliveryMethods: DeliveryMethod[] = ['Pick Up Forwarder', 'Hand Carry'];

const schema = z.object({
    related_job_order_id: z.string().uuid('Select the Job Order'),
    related_po_id: z.string().uuid().nullable(),
    related_awb_id: z.string().uuid().nullable(),
    workshop_check_status: z.enum(workshopStatuses as [WorkshopCheckStatus, ...WorkshopCheckStatus[]]),
    ready_to_deliver: z.enum(yesNo as [YesNo, ...YesNo[]]).nullable().optional().or(z.literal('')),
    delivery_method: z.enum(deliveryMethods as [DeliveryMethod, ...DeliveryMethod[]]).nullable().optional().or(z.literal('')),
    workflow_status: z.enum(workflows as [SparepartWorkflow, ...SparepartWorkflow[]]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: SparepartRecord): FormValues {
    return {
        related_job_order_id: existing?.related_job_order_id ?? '',
        related_po_id: existing?.related_po_id ?? null,
        related_awb_id: existing?.related_awb_id ?? null,
        workshop_check_status: existing?.workshop_check_status ?? 'Pending',
        ready_to_deliver: existing?.ready_to_deliver ?? null,
        delivery_method: existing?.delivery_method ?? null,
        workflow_status: existing?.workflow_status ?? 'awaiting_awb',
        notes: existing?.notes ?? '',
    };
}

export function SparepartForm({ existing }: { existing?: SparepartRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [billingIds, setBillingIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'technical.sparepart',
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
            const payload: SparepartCreateInput = {
                related_job_order_id: parsed.data.related_job_order_id,
                related_po_id: parsed.data.related_po_id,
                related_awb_id: parsed.data.related_awb_id,
                workshop_check_status: parsed.data.workshop_check_status,
                ready_to_deliver:
                    (parsed.data.ready_to_deliver as YesNo | null | '') || null,
                delivery_method:
                    (parsed.data.delivery_method as DeliveryMethod | null | '') || null,
                workflow_status: parsed.data.workflow_status,
                notes: parsed.data.notes || null,
                billing_support_file_ids: billingIds.length > 0 ? billingIds : undefined,
            };
            if (existing) {
                await sparepartsApi.update(existing.id, payload);
                toast.success('Sparepart updated');
            } else {
                await sparepartsApi.create(payload);
                toast.success('Sparepart created');
            }
            draft.clearDraft();
            router.replace('/technical/spareparts');
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
                Setting <strong>Ready to Deliver = Yes</strong> signals Admin &amp; Log
                and starts the 2-working-day response SLA. Uploading billing
                support files notifies Finance.
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
                <FormField label="Related AWB" name="related_awb_id">
                    <Controller
                        name="related_awb_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/admin-log/awb"
                                labelKey="awb_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Workshop Check" name="workshop_check_status">
                    <select
                        {...form.register('workshop_check_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {workshopStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField
                    label="Ready to Deliver" name="ready_to_deliver"
                    hint="Setting Yes starts 2-day Admin & Log response SLA."
                >
                    <select
                        {...form.register('ready_to_deliver')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {yesNo.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                </FormField>
                <FormField label="Delivery Method" name="delivery_method">
                    <select
                        {...form.register('delivery_method')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {deliveryMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
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

            <div>
                <p className="mb-1 text-sm font-medium">Billing Support Documents</p>
                <p className="mb-1 text-xs text-muted-foreground">
                    Uploading here hands billing context off to Finance.
                </p>
                <MultiFileUpload
                    entityModule="technical.sparepart_billing"
                    entityId={existing?.id}
                    onChange={setBillingIds}
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

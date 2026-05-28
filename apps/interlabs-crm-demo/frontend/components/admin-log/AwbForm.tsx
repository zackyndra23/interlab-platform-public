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
import { awbApi } from '@/lib/admin-log-api';
import type { AwbInput, AwbRecord, ShipmentMethod } from '@/lib/admin-log-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * AWB create/edit form.
 *
 * Automation: the backend detects field writes (`awb_tracking_number`,
 * `transit_date`, `arrival_date`) on the same PUT and advances the master
 * PO through Shipped → Customs → Arrived. The form doesn't need
 * dedicated submit/transition buttons for those — saving the row with the
 * trigger field filled is enough (per MOD_admin_log §AWB STATUS
 * AUTOMATION).
 */

const shipmentMethods: ShipmentMethod[] = ['Air', 'Sea', 'Land', 'Courier'];

const schema = z.object({
    related_po_id: z.string().uuid('Select the related PO'),
    related_po_number: z.string().max(200).nullable().optional(),
    customer_id: z.string().uuid().nullable(),
    supplier_or_manufacturer: z.string().max(500).nullable().optional(),
    forwarder_or_courier: z.string().max(500).nullable().optional(),
    awb_tracking_number: z.string().max(200).nullable().optional(),
    shipment_method: z.enum(shipmentMethods as [ShipmentMethod, ...ShipmentMethod[]])
        .nullable().optional().or(z.literal('')),
    origin_country: z.string().max(200).nullable().optional(),
    transit_country_or_hub: z.string().max(200).nullable().optional(),
    destination: z.string().max(200).nullable().optional(),
    despatch_date: z.string().nullable().optional(),
    transit_date: z.string().nullable().optional(),
    arrival_date: z.string().nullable().optional(),
    weight_kg: z.union([z.number().nonnegative(), z.null()]),
    package_count: z.union([z.number().int().nonnegative(), z.null()]),
    description_of_goods: z.string().nullable().optional(),
    incoterm: z.string().max(50).nullable().optional(),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: AwbRecord): FormValues {
    return {
        related_po_id: existing?.related_po_id ?? '',
        related_po_number: existing?.related_po_number ?? '',
        customer_id: existing?.customer_id ?? null,
        supplier_or_manufacturer: existing?.supplier_or_manufacturer ?? '',
        forwarder_or_courier: existing?.forwarder_or_courier ?? '',
        awb_tracking_number: existing?.awb_tracking_number ?? '',
        shipment_method: existing?.shipment_method ?? null,
        origin_country: existing?.origin_country ?? '',
        transit_country_or_hub: existing?.transit_country_or_hub ?? '',
        destination: existing?.destination ?? '',
        despatch_date: existing?.despatch_date ?? '',
        transit_date: existing?.transit_date ?? '',
        arrival_date: existing?.arrival_date ?? '',
        weight_kg: existing?.weight_kg ?? null,
        package_count: existing?.package_count ?? null,
        description_of_goods: existing?.description_of_goods ?? '',
        incoterm: existing?.incoterm ?? '',
        notes: existing?.notes ?? '',
    };
}

export function AwbForm({ existing }: { existing?: AwbRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'admin_log.awb',
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
            const payload: AwbInput = {
                ...parsed.data,
                // Normalise enums and empty strings the backend expects null for.
                shipment_method: (parsed.data.shipment_method as ShipmentMethod | null | '') || null,
                related_po_number: parsed.data.related_po_number || null,
                despatch_date: parsed.data.despatch_date || null,
                transit_date: parsed.data.transit_date || null,
                arrival_date: parsed.data.arrival_date || null,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await awbApi.update(existing.id, payload);
                toast.success('AWB updated — PO status may advance automatically');
            } else {
                await awbApi.create(payload);
                toast.success('AWB created');
            }
            draft.clearDraft();
            router.replace('/admin-log/awb');
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
                Saving this AWB automatically advances the master PO:
                tracking number → <strong>Shipped</strong>,
                transit date → <strong>Customs</strong>,
                arrival date → <strong>Arrived</strong>.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField
                    label="Related PO" name="related_po_id" required
                    error={form.formState.errors.related_po_id?.message}
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
                <FormField label="Supplier / Manufacturer" name="supplier_or_manufacturer">
                    <Input {...form.register('supplier_or_manufacturer')} />
                </FormField>
                <FormField label="Forwarder / Courier" name="forwarder_or_courier">
                    <Input {...form.register('forwarder_or_courier')} />
                </FormField>
                <FormField
                    label="AWB Tracking Number" name="awb_tracking_number"
                    hint="Saving with this field set advances PO → Shipped"
                >
                    <Input {...form.register('awb_tracking_number')} />
                </FormField>
                <FormField label="Shipment Method" name="shipment_method">
                    <select
                        {...form.register('shipment_method')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {shipmentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                </FormField>
                <FormField label="Origin" name="origin_country">
                    <Input {...form.register('origin_country')} />
                </FormField>
                <FormField label="Transit Country / Hub" name="transit_country_or_hub">
                    <Input {...form.register('transit_country_or_hub')} />
                </FormField>
                <FormField label="Destination" name="destination">
                    <Input {...form.register('destination')} />
                </FormField>
                <FormField label="Incoterm" name="incoterm">
                    <Input {...form.register('incoterm')} />
                </FormField>
                <FormField label="Despatch Date" name="despatch_date">
                    <Controller
                        name="despatch_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField
                    label="Transit Date" name="transit_date"
                    hint="Saving with this set advances PO → Customs"
                >
                    <Controller
                        name="transit_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField
                    label="Arrival Date" name="arrival_date"
                    hint="Saving with this set advances PO → Arrived"
                >
                    <Controller
                        name="arrival_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Weight (kg)" name="weight_kg">
                    <Input
                        type="number"
                        step="0.001"
                        {...form.register('weight_kg', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
                <FormField label="Packages" name="package_count">
                    <Input
                        type="number"
                        min={0}
                        {...form.register('package_count', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
                <FormField label="Description of Goods" name="description_of_goods" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('description_of_goods')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField label="Notes" name="notes" className="md:col-span-2">
                    <textarea
                        rows={3}
                        {...form.register('notes')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="admin_log.awb_records"
                    entityId={existing?.id ?? null}
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

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
import { deliveryOrdersApi } from '@/lib/admin-log-api';
import type {
    DeliveryOrder, DeliveryOrderInput, DoItem,
} from '@/lib/admin-log-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';
import { DoItemListEditor } from './DoItemListEditor';

/**
 * Delivery Order create/edit form.
 *
 * Automation: `delivery_order_number` → advances master PO to Delivery;
 * `customer_arrival_date` → flips DO status to Arrived (PO stage
 * unchanged at that step per MOD_admin_log §FORM 2 Trigger 2).
 */

const schema = z.object({
    related_po_id: z.string().uuid('Select the related PO'),
    related_po_number: z.string().max(200).nullable().optional(),
    customer_id: z.string().uuid().nullable(),
    delivery_order_number: z.string().max(200).nullable().optional(),
    delivery_date: z.string().nullable().optional(),
    shipping_method: z.string().max(200).nullable().optional(),
    courier_or_expedition_vendor: z.string().max(500).nullable().optional(),
    dispatch_from: z.string().max(500).nullable().optional(),
    delivery_address: z.string().nullable().optional(),
    invoicing_address: z.string().nullable().optional(),
    technical_inspection_reference_date: z.string().nullable().optional(),
    customer_arrival_date: z.string().nullable().optional(),
    remarks: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: DeliveryOrder): FormValues {
    return {
        related_po_id: existing?.related_po_id ?? '',
        related_po_number: existing?.related_po_number ?? '',
        customer_id: existing?.customer_id ?? null,
        delivery_order_number: existing?.delivery_order_number ?? '',
        delivery_date: existing?.delivery_date ?? '',
        shipping_method: existing?.shipping_method ?? '',
        courier_or_expedition_vendor: existing?.courier_or_expedition_vendor ?? '',
        dispatch_from: existing?.dispatch_from ?? '',
        delivery_address: existing?.delivery_address ?? '',
        invoicing_address: existing?.invoicing_address ?? '',
        technical_inspection_reference_date: existing?.technical_inspection_reference_date ?? '',
        customer_arrival_date: existing?.customer_arrival_date ?? '',
        remarks: existing?.remarks ?? '',
    };
}

export function DeliveryOrderForm({ existing }: { existing?: DeliveryOrder }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<DoItem[]>(existing?.item_list ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: DoItem[] }>({
        formKey: 'admin_log.delivery_order',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
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
            const payload: DeliveryOrderInput = {
                ...parsed.data,
                related_po_number: parsed.data.related_po_number || null,
                delivery_date: parsed.data.delivery_date || null,
                technical_inspection_reference_date: parsed.data.technical_inspection_reference_date || null,
                customer_arrival_date: parsed.data.customer_arrival_date || null,
                item_list: items,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await deliveryOrdersApi.update(existing.id, payload);
                toast.success('Delivery order updated');
            } else {
                await deliveryOrdersApi.create(payload);
                toast.success('Delivery order created');
            }
            draft.clearDraft();
            router.replace('/admin-log/delivery-orders');
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
                        if (d) { form.reset(d.form); setItems(d.items); }
                        setBannerSeen(true);
                    }}
                    onDiscard={() => { draft.clearDraft(); setBannerSeen(true); }}
                />
            )}

            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                Saving with DO number fills advances the master PO to <strong>Delivery</strong>.
                Customer arrival date flips this DO to <strong>Arrived</strong>.
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
                <FormField
                    label="DO Number" name="delivery_order_number"
                    hint="Saving with this set advances PO → Delivery"
                >
                    <Input {...form.register('delivery_order_number')} />
                </FormField>
                <FormField label="Delivery Date" name="delivery_date">
                    <Controller
                        name="delivery_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Shipping Method" name="shipping_method">
                    <Input {...form.register('shipping_method')} />
                </FormField>
                <FormField label="Courier / Vendor" name="courier_or_expedition_vendor">
                    <Input {...form.register('courier_or_expedition_vendor')} />
                </FormField>
                <FormField label="Dispatch From" name="dispatch_from">
                    <Input {...form.register('dispatch_from')} />
                </FormField>
                <FormField
                    label="Technical Inspection Date"
                    name="technical_inspection_reference_date"
                    hint="From Technical inspection record"
                >
                    <Controller
                        name="technical_inspection_reference_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField
                    label="Customer Arrival Date"
                    name="customer_arrival_date"
                    hint="Flips DO to Arrived; PO stage unchanged"
                >
                    <Controller
                        name="customer_arrival_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Delivery Address" name="delivery_address" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('delivery_address')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField label="Invoicing Address" name="invoicing_address" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('invoicing_address')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Items</p>
                <DoItemListEditor value={items} onChange={setItems} />
            </div>

            <FormField label="Remarks" name="remarks">
                <textarea
                    rows={3}
                    {...form.register('remarks')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="admin_log.delivery_orders"
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

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
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import type {
    Currency, FinanceItem,
    PurchaseRequisition, PurchaseRequisitionInput,
} from '@/lib/finance-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';
import { FinanceItemListEditor } from './FinanceItemListEditor';

/**
 * Finance Purchase Requisition edit form.
 *
 * No create path — rows are auto-seeded by Sales PR submission. This
 * form edits the PR envelope (supplier, manufacturer contact,
 * shipping, item list). The PO-Out issue step is a separate inline
 * panel on the detail page (`UploadPoOutPanel`) because the backend
 * validator requires atomic submission of number + date + attachment.
 */

const schema = z.object({
    related_po_customer_id: z.string().uuid().nullable(),
    customer_id: z.string().uuid().nullable(),
    supplier_or_manufacturer: z.string().max(500).nullable().optional(),
    manufacturer_contact_person: z.string().max(500).nullable().optional(),
    manufacturer_email: z.string().email('Invalid email').nullable().optional().or(z.literal('')),
    pr_number: z.string().max(200).nullable().optional(),
    pr_date: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    incoterm: z.string().max(50).nullable().optional(),
    delivery_time: z.string().max(200).nullable().optional(),
    payment_term: z.string().max(200).nullable().optional(),
    shipping_address: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing: PurchaseRequisition): FormValues {
    return {
        related_po_customer_id: existing.related_po_customer_id ?? null,
        customer_id: existing.customer_id ?? null,
        supplier_or_manufacturer: existing.supplier_or_manufacturer ?? '',
        manufacturer_contact_person: existing.manufacturer_contact_person ?? '',
        manufacturer_email: existing.manufacturer_email ?? '',
        pr_number: existing.pr_number ?? '',
        pr_date: existing.pr_date ?? '',
        currency: (existing.currency as Currency) ?? 'IDR',
        incoterm: existing.incoterm ?? '',
        delivery_time: existing.delivery_time ?? '',
        payment_term: existing.payment_term ?? '',
        shipping_address: existing.shipping_address ?? '',
        notes: existing.notes ?? '',
    };
}

export function PurchaseRequisitionForm({ existing }: { existing: PurchaseRequisition }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<FinanceItem[]>(existing.item_list ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: FinanceItem[] }>({
        formKey: 'finance.purchase_requisition',
        recordId: existing.id,
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
            const item_list: FinanceItem[] = items.map((r) => ({
                ...r,
                total_price: (r.qty || 0) * (r.unit_price || 0),
            }));
            const payload: PurchaseRequisitionInput = {
                ...parsed.data,
                manufacturer_email: parsed.data.manufacturer_email || null,
                pr_date: parsed.data.pr_date || null,
                item_list,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            await purchaseRequisitionsApi.update(existing.id, payload);
            toast.success('Purchase requisition updated');
            draft.clearDraft();
            router.replace('/finance/purchase-requisitions');
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

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="PR Number" name="pr_number">
                    <Input {...form.register('pr_number')} />
                </FormField>
                <FormField label="PR Date" name="pr_date">
                    <Controller
                        name="pr_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
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
                <FormField label="Related PO Customer" name="related_po_customer_id">
                    <Controller
                        name="related_po_customer_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/finance/po-customers"
                                labelKey="po_customer_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Supplier / Manufacturer" name="supplier_or_manufacturer">
                    <Input {...form.register('supplier_or_manufacturer')} />
                </FormField>
                <FormField label="Contact Person" name="manufacturer_contact_person">
                    <Input {...form.register('manufacturer_contact_person')} />
                </FormField>
                <FormField label="Manufacturer Email" name="manufacturer_email"
                    error={form.formState.errors.manufacturer_email?.message}>
                    <Input type="email" {...form.register('manufacturer_email')} />
                </FormField>
                <FormField label="Currency" name="currency">
                    <select
                        {...form.register('currency')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="IDR">IDR</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                    </select>
                </FormField>
                <FormField label="Incoterm" name="incoterm">
                    <Input {...form.register('incoterm')} />
                </FormField>
                <FormField label="Delivery Time" name="delivery_time">
                    <Input {...form.register('delivery_time')} />
                </FormField>
                <FormField label="Payment Term" name="payment_term">
                    <Input {...form.register('payment_term')} />
                </FormField>
                <FormField label="Shipping Address" name="shipping_address" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('shipping_address')}
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

            <div className="space-y-2">
                <p className="text-sm font-medium">Items</p>
                <FinanceItemListEditor value={items} onChange={setItems} />
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">Excel PR Attachments</p>
                <MultiFileUpload
                    entityModule="finance.purchase_requisitions"
                    entityId={existing.id}
                    onChange={setAttachmentIds}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel="Save"
                submitting={submitting}
            />
        </form>
    );
}

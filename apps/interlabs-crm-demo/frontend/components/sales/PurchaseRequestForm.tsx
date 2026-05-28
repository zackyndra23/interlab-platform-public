'use client';

import { useMemo, useState } from 'react';
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
import { formatCurrency } from '@/lib/utils';
import { purchaseRequestsApi } from '@/lib/sales-api';
import type {
    Currency, Incoterm, PoItem, PurchaseRequestSales, PurchaseRequestSalesInput,
} from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';
import { ItemListEditor, type BasicItem } from './ItemListEditor';

const incoterms: Incoterm[] = ['EXW', 'FOB', 'CIF', 'DDP', 'DAP', 'CPT', 'FCA'];

const schema = z.object({
    related_po_id: z.string().uuid().nullable(),
    customer_id: z.string().uuid().nullable(),
    supplier_or_manufacturer: z.string().max(500).nullable().optional(),
    manufacturer_contact: z.string().max(200).nullable().optional(),
    manufacturer_email: z.string().email('Invalid email').nullable().optional().or(z.literal('')),
    pr_date: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    incoterm: z.enum(incoterms as [Incoterm, ...Incoterm[]]).nullable().optional(),
    delivery_time: z.string().max(200).nullable().optional(),
    payment_terms: z.string().max(200).nullable().optional(),
    shipping_address: z.string().nullable().optional(),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: PurchaseRequestSales): FormValues {
    return {
        related_po_id: existing?.related_po_id ?? null,
        customer_id: existing?.customer_id ?? null,
        supplier_or_manufacturer: existing?.supplier_or_manufacturer ?? '',
        manufacturer_contact: existing?.manufacturer_contact ?? '',
        manufacturer_email: existing?.manufacturer_email ?? '',
        pr_date: existing?.pr_date ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        incoterm: existing?.incoterm ?? null,
        delivery_time: existing?.delivery_time ?? '',
        payment_terms: existing?.payment_terms ?? '',
        shipping_address: existing?.shipping_address ?? '',
        notes: existing?.notes ?? '',
    };
}

export function PurchaseRequestForm({ existing }: { existing?: PurchaseRequestSales }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<BasicItem[]>(
        (existing?.item_list as BasicItem[] | undefined) ?? [],
    );

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: BasicItem[] }>({
        formKey: 'sales.pr',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const subtotal = useMemo(
        () => items.reduce((acc, r) => acc + (r.qty || 0) * (r.unit_price || 0), 0),
        [items],
    );

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const item_list: PoItem[] = items.map((r) => ({
                ...r,
                total_price: (r.qty || 0) * (r.unit_price || 0),
            }));
            const payload: PurchaseRequestSalesInput = {
                ...parsed.data,
                manufacturer_email: parsed.data.manufacturer_email || null,
                pr_date: parsed.data.pr_date || null,
                item_list,
                workflow_status: existing?.workflow_status ?? 'draft',
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await purchaseRequestsApi.update(existing.id, payload);
                toast.success('Purchase request updated');
            } else {
                await purchaseRequestsApi.create(payload);
                toast.success('Purchase request created');
            }
            draft.clearDraft();
            router.replace('/sales/purchase-requests');
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
                <FormField label="Supplier / Manufacturer" name="supplier_or_manufacturer">
                    <Input {...form.register('supplier_or_manufacturer')} />
                </FormField>
                <FormField label="Manufacturer Contact" name="manufacturer_contact">
                    <Input {...form.register('manufacturer_contact')} />
                </FormField>
                <FormField label="Manufacturer Email" name="manufacturer_email" error={form.formState.errors.manufacturer_email?.message}>
                    <Input type="email" {...form.register('manufacturer_email')} />
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
                    <select
                        {...form.register('incoterm')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {incoterms.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                </FormField>
                <FormField label="Delivery Time" name="delivery_time">
                    <Input {...form.register('delivery_time')} />
                </FormField>
                <FormField label="Payment Terms" name="payment_terms">
                    <Input {...form.register('payment_terms')} />
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
                <p className="text-sm font-medium">Line Items</p>
                <ItemListEditor kind="basic" value={items} onChange={setItems} />
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between font-semibold">
                    <span>Subtotal</span>
                    <span>{formatCurrency(subtotal, values.currency)}</span>
                </div>
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="sales.purchase_requests"
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

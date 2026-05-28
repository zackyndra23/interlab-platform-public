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
import { salesPoApi } from '@/lib/sales-api';
import type {
    Currency, SalesPurchaseOrder, SalesPurchaseOrderInput, PoItem,
} from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';
import { ItemListEditor, type BasicItem } from './ItemListEditor';

const schema = z.object({
    po_number: z.string().min(1, 'PO number is required').max(200),
    customer_id: z.string().uuid().nullable(),
    related_quotation_id: z.string().uuid().nullable(),
    order_date: z.string().nullable().optional(),
    delivery_deadline: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    payment_terms: z.string().max(200).nullable().optional(),
    delivery_terms: z.string().max(200).nullable().optional(),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: SalesPurchaseOrder): FormValues {
    return {
        po_number: existing?.po_number ?? '',
        customer_id: existing?.customer_id ?? null,
        related_quotation_id: existing?.related_quotation_id ?? null,
        order_date: existing?.order_date ?? '',
        delivery_deadline: existing?.delivery_deadline ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        payment_terms: existing?.payment_terms ?? '',
        delivery_terms: existing?.delivery_terms ?? '',
        notes: existing?.notes ?? '',
    };
}

export function SalesPoForm({ existing }: { existing?: SalesPurchaseOrder }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<BasicItem[]>(
        (existing?.item_list as BasicItem[] | undefined) ?? [],
    );

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: BasicItem[] }>({
        formKey: 'sales.po',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const totals = useMemo(() => {
        const subtotal = items.reduce(
            (acc, r) => acc + (r.qty || 0) * (r.unit_price || 0), 0,
        );
        // Tax kept simple here; form does not edit a tax rate. Finance
        // handles tax calculations downstream; this number is a carry-over
        // from the quotation where applicable.
        const tax_amount = existing?.tax_amount ?? 0;
        const total_amount = subtotal + tax_amount;
        return { subtotal, tax_amount, total_amount };
    }, [items, existing?.tax_amount]);

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
            const payload: SalesPurchaseOrderInput = {
                ...parsed.data,
                order_date: parsed.data.order_date || null,
                delivery_deadline: parsed.data.delivery_deadline || null,
                payment_terms: parsed.data.payment_terms || null,
                delivery_terms: parsed.data.delivery_terms || null,
                item_list,
                subtotal: totals.subtotal,
                tax_amount: totals.tax_amount,
                total_amount: totals.total_amount,
                workflow_status: existing?.workflow_status ?? 'draft',
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await salesPoApi.update(existing.id, payload);
                toast.success('PO updated');
            } else {
                await salesPoApi.create(payload);
                toast.success('PO created');
            }
            draft.clearDraft();
            router.replace('/sales/purchase-orders');
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
                <FormField
                    label="PO Number" name="po_number" required
                    error={form.formState.errors.po_number?.message}
                    hint="From the customer's PO document"
                >
                    <Input {...form.register('po_number', { required: true })} />
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
                <FormField label="Related Quotation" name="related_quotation_id">
                    <Controller
                        name="related_quotation_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/quotations"
                                labelKey="quotation_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
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
                <FormField label="Order Date" name="order_date">
                    <Controller
                        name="order_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Delivery Deadline" name="delivery_deadline" hint="Becomes PO due date">
                    <Controller
                        name="delivery_deadline"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Payment Terms" name="payment_terms">
                    <Input {...form.register('payment_terms')} />
                </FormField>
                <FormField label="Delivery Terms" name="delivery_terms">
                    <Input {...form.register('delivery_terms')} />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <ItemListEditor kind="basic" value={items} onChange={setItems} />
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(totals.subtotal, values.currency)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{formatCurrency(totals.tax_amount, values.currency)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(totals.total_amount, values.currency)}</span>
                </div>
            </div>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="sales.purchase_orders"
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

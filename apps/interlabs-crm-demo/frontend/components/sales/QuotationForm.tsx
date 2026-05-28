'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { quotationsApi } from '@/lib/sales-api';
import type {
    Currency, Quotation, QuotationInput, QuotationItem,
} from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';
import { ItemListEditor, type BasicItem } from './ItemListEditor';

const schema = z.object({
    quotation_number: z.string().max(200).nullable().optional(),
    customer_id: z.string().uuid().nullable(),
    related_forecast_id: z.string().uuid().nullable(),
    quotation_date: z.string().nullable().optional(),
    validity_date: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    discount_percent: z.number().min(0).max(100).nullable(),
    tax_percent: z.number().min(0).max(100).nullable(),
    payment_terms: z.string().max(200).nullable().optional(),
    delivery_terms: z.string().max(200).nullable().optional(),
    warranty_terms: z.string().max(500).nullable().optional(),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: Quotation): FormValues {
    return {
        quotation_number: existing?.quotation_number ?? '',
        customer_id: existing?.customer_id ?? null,
        related_forecast_id: existing?.related_forecast_id ?? null,
        quotation_date: existing?.quotation_date ?? '',
        validity_date: existing?.validity_date ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        discount_percent: existing?.discount_percent ?? 0,
        tax_percent: existing?.tax_percent ?? 0,
        payment_terms: existing?.payment_terms ?? '',
        delivery_terms: existing?.delivery_terms ?? '',
        warranty_terms: existing?.warranty_terms ?? '',
        notes: existing?.notes ?? '',
    };
}

export function QuotationForm({ existing }: { existing?: Quotation }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<BasicItem[]>(
        (existing?.item_list as BasicItem[] | undefined) ?? [],
    );

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: BasicItem[] }>({
        formKey: 'sales.quotation',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    // Auto-compute total_price per line whenever qty/unit_price changes.
    useEffect(() => {
        setItems((rows) => rows.map((r) => ({
            ...r,
            total_price: Number((r.qty || 0) * (r.unit_price || 0)).valueOf(),
        })));
    }, []); // initial pass only — subsequent edits happen in the repeater

    // Compute subtotal / discount / tax / total every render.
    const totals = useMemo(() => {
        const subtotal = items.reduce((acc, r) => acc + (r.total_price || 0), 0);
        const discountPct = Number(values.discount_percent) || 0;
        const taxPct = Number(values.tax_percent) || 0;
        const discount_amount = subtotal * (discountPct / 100);
        const afterDiscount = subtotal - discount_amount;
        const tax_amount = afterDiscount * (taxPct / 100);
        const total_amount = afterDiscount + tax_amount;
        return { subtotal, discount_amount, tax_amount, total_amount };
    }, [items, values.discount_percent, values.tax_percent]);

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            // Recompute per-line totals one more time before send.
            const item_list: QuotationItem[] = items.map((r) => ({
                ...r,
                total_price: (r.qty || 0) * (r.unit_price || 0),
            }));
            const payload: QuotationInput = {
                ...parsed.data,
                quotation_number: parsed.data.quotation_number || null,
                quotation_date: parsed.data.quotation_date || null,
                validity_date: parsed.data.validity_date || null,
                payment_terms: parsed.data.payment_terms || null,
                delivery_terms: parsed.data.delivery_terms || null,
                warranty_terms: parsed.data.warranty_terms || null,
                item_list,
                subtotal: totals.subtotal,
                discount_amount: totals.discount_amount,
                tax_amount: totals.tax_amount,
                total_amount: totals.total_amount,
                workflow_status: existing?.workflow_status ?? 'draft',
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await quotationsApi.update(existing.id, payload);
                toast.success('Quotation updated');
            } else {
                await quotationsApi.create(payload);
                toast.success('Quotation created');
            }
            draft.clearDraft();
            router.replace('/sales/quotations');
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
                <FormField label="Quotation Number" name="quotation_number">
                    <Input {...form.register('quotation_number')} />
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
                <FormField label="Related Forecast" name="related_forecast_id">
                    <Controller
                        name="related_forecast_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/forecasts"
                                labelKey="forecast_record_number"
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
                <FormField label="Quotation Date" name="quotation_date">
                    <Controller
                        name="quotation_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Validity Date" name="validity_date">
                    <Controller
                        name="validity_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <ItemListEditor kind="basic" value={items} onChange={setItems} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Discount %" name="discount_percent">
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        {...form.register('discount_percent', { valueAsNumber: true })}
                    />
                </FormField>
                <FormField label="Tax %" name="tax_percent">
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        {...form.register('tax_percent', { valueAsNumber: true })}
                    />
                </FormField>
                <FormField label="Payment Terms" name="payment_terms">
                    <Input {...form.register('payment_terms')} />
                </FormField>
                <FormField label="Delivery Terms" name="delivery_terms">
                    <Input {...form.register('delivery_terms')} />
                </FormField>
                <FormField label="Warranty Terms" name="warranty_terms" className="md:col-span-2">
                    <Input {...form.register('warranty_terms')} />
                </FormField>
                <FormField label="Notes" name="notes" className="md:col-span-2">
                    <textarea
                        rows={3}
                        {...form.register('notes')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <TotalsRow label="Subtotal" value={totals.subtotal} currency={values.currency} />
                <TotalsRow label="Discount" value={-totals.discount_amount} currency={values.currency} />
                <TotalsRow label="Tax" value={totals.tax_amount} currency={values.currency} />
                <div className="mt-1 border-t border-border pt-1">
                    <TotalsRow label="Total" value={totals.total_amount} currency={values.currency} bold />
                </div>
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="sales.quotations"
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

function TotalsRow({
    label, value, currency, bold,
}: {
    label: string;
    value: number;
    currency: Currency;
    bold?: boolean;
}) {
    return (
        <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
            <span>{label}</span>
            <span>{formatCurrency(value, currency)}</span>
        </div>
    );
}

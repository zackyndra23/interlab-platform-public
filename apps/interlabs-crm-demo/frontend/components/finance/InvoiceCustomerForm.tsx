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
import { invoiceCustomersApi } from '@/lib/finance-api';
import { formatCurrency } from '@/lib/utils';
import type {
    Currency, FinanceItem,
    InvoiceCustomer, InvoiceCustomerInput,
} from '@/lib/finance-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';
import { FinanceItemListEditor } from './FinanceItemListEditor';

/**
 * Invoice Customer edit form.
 *
 * Draft auto-created by Technical BAST upload. Finance edits the
 * invoice envelope here; the `invoice_number` / issue attachment step
 * lives in the inline UploadInvoicePanel on the detail page (atomic
 * per backend validator `invoiceCustomerUploadInvoice`).
 */

const schema = z.object({
    related_po_customer_id: z.string().uuid().nullable(),
    related_bast_id: z.string().uuid().nullable(),
    related_do_id: z.string().uuid().nullable(),
    related_po_id: z.string().uuid().nullable(),
    customer_id: z.string().uuid().nullable(),
    invoice_date: z.string().nullable().optional(),
    customer_order_number: z.string().max(200).nullable().optional(),
    order_date: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    shipping_method: z.string().max(200).nullable().optional(),
    discount_amount: z.union([z.number().nonnegative(), z.null()]),
    vat_percent: z.union([z.number().nonnegative(), z.null()]),
    billing_account_info: z.string().nullable().optional(),
    payment_due_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing: InvoiceCustomer): FormValues {
    return {
        related_po_customer_id: existing.related_po_customer_id ?? null,
        related_bast_id: existing.related_bast_id ?? null,
        related_do_id: existing.related_do_id ?? null,
        related_po_id: existing.related_po_id ?? null,
        customer_id: existing.customer_id ?? null,
        invoice_date: existing.invoice_date ?? '',
        customer_order_number: existing.customer_order_number ?? '',
        order_date: existing.order_date ?? '',
        currency: (existing.currency as Currency) ?? 'IDR',
        shipping_method: existing.shipping_method ?? '',
        discount_amount: existing.discount_amount ?? 0,
        vat_percent: existing.vat_percent ?? 0,
        billing_account_info: existing.billing_account_info ?? '',
        payment_due_date: existing.payment_due_date ?? '',
        notes: existing.notes ?? '',
    };
}

export function InvoiceCustomerForm({ existing }: { existing: InvoiceCustomer }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<FinanceItem[]>(existing.item_list ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: FinanceItem[] }>({
        formKey: 'finance.invoice_customer',
        recordId: existing.id,
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const totals = useMemo(() => {
        const subtotal = items.reduce(
            (acc, r) => acc + (r.qty || 0) * (r.unit_price || 0), 0,
        );
        const discount = Number(values.discount_amount) || 0;
        const tax_base = subtotal - discount;
        const vat_amount = tax_base * ((Number(values.vat_percent) || 0) / 100);
        return {
            subtotal, tax_base, vat_amount,
            total_amount: tax_base + vat_amount,
        };
    }, [items, values.discount_amount, values.vat_percent]);

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
            const payload: InvoiceCustomerInput = {
                ...parsed.data,
                invoice_date: parsed.data.invoice_date || null,
                order_date: parsed.data.order_date || null,
                payment_due_date: parsed.data.payment_due_date || null,
                item_list,
                subtotal: totals.subtotal,
                tax_base: totals.tax_base,
                vat_amount: totals.vat_amount,
                total_amount: totals.total_amount,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            await invoiceCustomersApi.update(existing.id, payload);
            toast.success('Invoice Customer updated');
            draft.clearDraft();
            router.replace('/finance/invoice-customers');
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
                <FormField label="Related BAST" name="related_bast_id">
                    <Controller
                        name="related_bast_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/technical/bast"
                                labelKey="bast_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Related DO" name="related_do_id">
                    <Controller
                        name="related_do_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/admin-log/delivery-orders"
                                labelKey="do_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Customer Order Number" name="customer_order_number">
                    <Input {...form.register('customer_order_number')} />
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
                <FormField label="Invoice Date" name="invoice_date">
                    <Controller
                        name="invoice_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Payment Due Date" name="payment_due_date">
                    <Controller
                        name="payment_due_date"
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
                <FormField label="Shipping Method" name="shipping_method">
                    <Input {...form.register('shipping_method')} />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <FinanceItemListEditor value={items} onChange={setItems} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Discount Amount" name="discount_amount">
                    <Input
                        type="number"
                        step="0.01"
                        min={0}
                        {...form.register('discount_amount', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
                <FormField label="VAT %" name="vat_percent">
                    <Input
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        {...form.register('vat_percent', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <Row label="Subtotal" value={totals.subtotal} currency={values.currency} />
                <Row label="Discount" value={-(Number(values.discount_amount) || 0)} currency={values.currency} />
                <Row label="Tax Base" value={totals.tax_base} currency={values.currency} />
                <Row label="VAT" value={totals.vat_amount} currency={values.currency} />
                <div className="mt-1 border-t border-border pt-1">
                    <Row label="Total" value={totals.total_amount} currency={values.currency} bold />
                </div>
            </div>

            <FormField label="Billing Account Info" name="billing_account_info">
                <textarea
                    rows={2}
                    {...form.register('billing_account_info')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
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
                    entityModule="finance.invoice_customers"
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

function Row({
    label, value, currency, bold,
}: {
    label: string; value: number; currency: Currency; bold?: boolean;
}) {
    return (
        <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
            <span>{label}</span>
            <span>{formatCurrency(value, currency)}</span>
        </div>
    );
}

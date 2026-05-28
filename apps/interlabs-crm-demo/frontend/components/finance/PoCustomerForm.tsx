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
import { poCustomersApi } from '@/lib/finance-api';
import type {
    Currency, FinanceItem, PoCustomer, PoCustomerInput,
} from '@/lib/finance-types';
import { formatCurrency } from '@/lib/utils';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';
import { FinanceItemListEditor } from './FinanceItemListEditor';

/**
 * PO Customer edit form.
 *
 * No create path — the row is auto-seeded when Sales submits a PO.
 * Finance edits the financial envelope (terms, billing/shipping,
 * item_list, tax). `workflow_status` and `current_po_status` are
 * driven by cross-division automation and rendered read-only on the
 * detail page.
 */

const schema = z.object({
    po_customer_number: z.string().max(200).nullable().optional(),
    customer_id: z.string().uuid().nullable(),
    version: z.string().max(50).nullable().optional(),
    order_date: z.string().nullable().optional(),
    quotation_reference_id: z.string().uuid().nullable(),
    payment_term_condition: z.string().max(200).nullable().optional(),
    delivery_term: z.string().max(200).nullable().optional(),
    term_of_payment: z.string().max(200).nullable().optional(),
    warranty: z.string().nullable().optional(),
    penalty_clause: z.string().nullable().optional(),
    bill_to: z.string().nullable().optional(),
    ship_to: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    tax_percent: z.union([z.number().nonnegative(), z.null()]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing: PoCustomer): FormValues {
    return {
        po_customer_number: existing.po_customer_number ?? '',
        customer_id: existing.customer_id ?? null,
        version: existing.version ?? '',
        order_date: existing.order_date ?? '',
        quotation_reference_id: existing.quotation_reference_id ?? null,
        payment_term_condition: existing.payment_term_condition ?? '',
        delivery_term: existing.delivery_term ?? '',
        term_of_payment: existing.term_of_payment ?? '',
        warranty: existing.warranty ?? '',
        penalty_clause: existing.penalty_clause ?? '',
        bill_to: existing.bill_to ?? '',
        ship_to: existing.ship_to ?? '',
        currency: (existing.currency as Currency) ?? 'IDR',
        tax_percent: existing.tax_percent ?? 0,
        notes: existing.notes ?? '',
    };
}

export function PoCustomerForm({ existing }: { existing: PoCustomer }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<FinanceItem[]>(existing.item_list ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: FinanceItem[] }>({
        formKey: 'finance.po_customer',
        recordId: existing.id,
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const totals = useMemo(() => {
        const subtotal = items.reduce(
            (acc, r) => acc + (r.qty || 0) * (r.unit_price || 0), 0,
        );
        const tax_amount = subtotal * ((Number(values.tax_percent) || 0) / 100);
        return { subtotal, tax_amount, total_amount: subtotal + tax_amount };
    }, [items, values.tax_percent]);

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
            const payload: PoCustomerInput = {
                ...parsed.data,
                order_date: parsed.data.order_date || null,
                item_list,
                subtotal: totals.subtotal,
                tax_amount: totals.tax_amount,
                total_amount: totals.total_amount,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            await poCustomersApi.update(existing.id, payload);
            toast.success('PO Customer updated');
            draft.clearDraft();
            router.replace('/finance/po-customers');
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
                <FormField label="Customer PO Number" name="po_customer_number">
                    <Input {...form.register('po_customer_number')} />
                </FormField>
                <FormField label="Version / Revision" name="version">
                    <Input {...form.register('version')} />
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
                <FormField label="Quotation Reference" name="quotation_reference_id">
                    <Controller
                        name="quotation_reference_id"
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
                <FormField label="Order Date" name="order_date">
                    <Controller
                        name="order_date"
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
                <FormField label="Payment Term Condition" name="payment_term_condition">
                    <Input {...form.register('payment_term_condition')} />
                </FormField>
                <FormField label="Delivery Term" name="delivery_term">
                    <Input {...form.register('delivery_term')} />
                </FormField>
                <FormField label="Term of Payment" name="term_of_payment">
                    <Input {...form.register('term_of_payment')} />
                </FormField>
                <FormField label="Warranty" name="warranty">
                    <Input {...form.register('warranty')} />
                </FormField>
                <FormField label="Bill To" name="bill_to" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('bill_to')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField label="Ship To" name="ship_to" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('ship_to')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField label="Penalty Clause" name="penalty_clause" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('penalty_clause')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <FinanceItemListEditor value={items} onChange={setItems} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Tax %" name="tax_percent">
                    <Input
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        {...form.register('tax_percent', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <TotalRow label="Subtotal" value={totals.subtotal} currency={values.currency} />
                <TotalRow label="Tax" value={totals.tax_amount} currency={values.currency} />
                <div className="mt-1 border-t border-border pt-1">
                    <TotalRow label="Total" value={totals.total_amount} currency={values.currency} bold />
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
                    entityModule="finance.po_customers"
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

function TotalRow({
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

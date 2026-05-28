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
import { invoiceManufacturesApi } from '@/lib/finance-api';
import { formatCurrency } from '@/lib/utils';
import type {
    Currency, FinanceItem,
    InvoiceManufacture, InvoiceManufactureInput,
} from '@/lib/finance-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';
import { FinanceItemListEditor } from './FinanceItemListEditor';

/**
 * Invoice Manufacture create/edit form.
 *
 * - On create: Finance enters invoice_number → backend flips
 *   `payment_status = 'Unpaid'` and emits
 *   `finance.invoice_manufacture.registered`.
 * - On edit: same CRUD shape minus the trigger fields managed by the
 *   UploadPaymentPanel (`payment_date`, `payment_amount`).
 */

const schema = z.object({
    related_pr_id: z.string().uuid().nullable(),
    related_po_out_number: z.string().max(200).nullable().optional(),
    related_po_id: z.string().uuid().nullable(),
    supplier_or_manufacturer: z.string().max(500).nullable().optional(),
    invoice_number: z.string().max(200).nullable().optional(),
    invoice_date: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    payment_terms: z.string().max(200).nullable().optional(),
    preferred_shipping: z.string().max(200).nullable().optional(),
    incoterm: z.string().max(50).nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    exchange_rate: z.union([z.number().nonnegative(), z.null()]),
    vat_percent: z.union([z.number().nonnegative(), z.null()]),
    bank_name: z.string().max(200).nullable().optional(),
    iban_or_account_number: z.string().max(200).nullable().optional(),
    bic_swift: z.string().max(50).nullable().optional(),
    transaction_reference: z.string().max(200).nullable().optional(),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: InvoiceManufacture): FormValues {
    return {
        related_pr_id: existing?.related_pr_id ?? null,
        related_po_out_number: existing?.related_po_out_number ?? '',
        related_po_id: existing?.related_po_id ?? null,
        supplier_or_manufacturer: existing?.supplier_or_manufacturer ?? '',
        invoice_number: existing?.invoice_number ?? '',
        invoice_date: existing?.invoice_date ?? '',
        due_date: existing?.due_date ?? '',
        payment_terms: existing?.payment_terms ?? '',
        preferred_shipping: existing?.preferred_shipping ?? '',
        incoterm: existing?.incoterm ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        exchange_rate: existing?.exchange_rate ?? null,
        vat_percent: existing?.vat_percent ?? 0,
        bank_name: existing?.bank_name ?? '',
        iban_or_account_number: existing?.iban_or_account_number ?? '',
        bic_swift: existing?.bic_swift ?? '',
        transaction_reference: existing?.transaction_reference ?? '',
        notes: existing?.notes ?? '',
    };
}

export function InvoiceManufactureForm({ existing }: { existing?: InvoiceManufacture }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<FinanceItem[]>(existing?.item_list ?? []);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: FinanceItem[] }>({
        formKey: 'finance.invoice_manufacture',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const totals = useMemo(() => {
        const untaxed_amount = items.reduce(
            (acc, r) => acc + (r.qty || 0) * (r.unit_price || 0), 0,
        );
        const vat_amount = untaxed_amount * ((Number(values.vat_percent) || 0) / 100);
        return { untaxed_amount, vat_amount, total_amount: untaxed_amount + vat_amount };
    }, [items, values.vat_percent]);

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
            const payload: InvoiceManufactureInput = {
                ...parsed.data,
                related_po_out_number: parsed.data.related_po_out_number || null,
                invoice_number: parsed.data.invoice_number || null,
                invoice_date: parsed.data.invoice_date || null,
                due_date: parsed.data.due_date || null,
                item_list,
                untaxed_amount: totals.untaxed_amount,
                vat_amount: totals.vat_amount,
                total_amount: totals.total_amount,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await invoiceManufacturesApi.update(existing.id, payload);
                toast.success('Invoice updated');
            } else {
                await invoiceManufacturesApi.create(payload);
                toast.success('Invoice registered');
            }
            draft.clearDraft();
            router.replace('/finance/invoice-manufactures');
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
                <FormField label="Related PR" name="related_pr_id">
                    <Controller
                        name="related_pr_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/finance/purchase-requisitions"
                                labelKey="pr_record_number"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </FormField>
                <FormField label="PO Out Number" name="related_po_out_number">
                    <Input {...form.register('related_po_out_number')} />
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
                <FormField label="Supplier / Manufacturer" name="supplier_or_manufacturer">
                    <Input {...form.register('supplier_or_manufacturer')} />
                </FormField>
                <FormField label="Invoice Number" name="invoice_number">
                    <Input {...form.register('invoice_number')} />
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
                <FormField label="Due Date" name="due_date">
                    <Controller
                        name="due_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Payment Terms" name="payment_terms">
                    <Input {...form.register('payment_terms')} />
                </FormField>
                <FormField label="Preferred Shipping" name="preferred_shipping">
                    <Input {...form.register('preferred_shipping')} />
                </FormField>
                <FormField label="Incoterm" name="incoterm">
                    <Input {...form.register('incoterm')} />
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
                <FormField label="Exchange Rate" name="exchange_rate" hint="For FX display only">
                    <Input
                        type="number"
                        step="0.000001"
                        {...form.register('exchange_rate', {
                            setValueAs: (v) => v === '' ? null : Number(v),
                        })}
                    />
                </FormField>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <FinanceItemListEditor value={items} onChange={setItems} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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
                <Row label="Untaxed Amount" value={totals.untaxed_amount} currency={values.currency} />
                <Row label="VAT" value={totals.vat_amount} currency={values.currency} />
                <div className="mt-1 border-t border-border pt-1">
                    <Row label="Total" value={totals.total_amount} currency={values.currency} bold />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Bank Name" name="bank_name">
                    <Input {...form.register('bank_name')} />
                </FormField>
                <FormField label="IBAN / Account Number" name="iban_or_account_number">
                    <Input {...form.register('iban_or_account_number')} />
                </FormField>
                <FormField label="BIC / SWIFT" name="bic_swift">
                    <Input {...form.register('bic_swift')} />
                </FormField>
                <FormField label="Transaction Reference" name="transaction_reference">
                    <Input {...form.register('transaction_reference')} />
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
                <p className="mb-1 text-sm font-medium">Invoice Attachments</p>
                <MultiFileUpload
                    entityModule="finance.invoice_manufactures"
                    entityId={existing?.id ?? null}
                    onChange={setAttachmentIds}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Register Invoice'}
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

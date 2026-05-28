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
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { MonthPicker } from '@/components/shared/MonthPicker';
import { CurrencyInput } from '@/components/shared/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { operationalApi } from '@/lib/admin-log-api';
import type {
    Currency, ExpenseStatus, OperationalInput, OperationalRecord, PaymentMethod,
} from '@/lib/admin-log-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Admin & Log operational (petty cash) form.
 *
 * `reporting_month` is the first day of the selected month. MonthPicker
 * returns `{month, year}` so we reconstruct an ISO date (`YYYY-MM-01`)
 * before send, matching the backend validator (`Joi.date().iso()`).
 */

const paymentMethods: PaymentMethod[] = ['Cash', 'Transfer', 'Credit Card'];
const expenseStatuses: ExpenseStatus[] = ['Pending', 'Paid', 'Cancelled'];

const schema = z.object({
    reporting_month_month: z.number().int().min(1).max(12),
    reporting_month_year: z.number().int().min(2000).max(2100),
    department: z.string().max(200).nullable().optional(),
    expense_category: z.string().max(200).nullable().optional(),
    expense_subcategory: z.string().max(200).nullable().optional(),
    transaction_date: z.string().nullable().optional(),
    period_start: z.string().nullable().optional(),
    period_end: z.string().nullable().optional(),
    vendor_or_payee: z.string().max(500).nullable().optional(),
    related_po_id: z.string().uuid().nullable(),
    description: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    amount: z.union([z.number().nonnegative(), z.null()]),
    payment_method: z.enum(paymentMethods as [PaymentMethod, ...PaymentMethod[]])
        .nullable().optional().or(z.literal('')),
    expense_status: z.enum(expenseStatuses as [ExpenseStatus, ...ExpenseStatus[]]),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function parseReportingMonth(iso: string | null): { month: number; year: number } {
    if (!iso) {
        const now = new Date();
        return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
    }
    const d = new Date(iso);
    return {
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
    };
}

function defaults(existing?: OperationalRecord): FormValues {
    const { month, year } = parseReportingMonth(existing?.reporting_month ?? null);
    return {
        reporting_month_month: month,
        reporting_month_year: year,
        department: existing?.department ?? 'Admin & Log',
        expense_category: existing?.expense_category ?? '',
        expense_subcategory: existing?.expense_subcategory ?? '',
        transaction_date: existing?.transaction_date ?? '',
        period_start: existing?.period_start ?? '',
        period_end: existing?.period_end ?? '',
        vendor_or_payee: existing?.vendor_or_payee ?? '',
        related_po_id: existing?.related_po_id ?? null,
        description: existing?.description ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        amount: existing?.amount ?? null,
        payment_method: existing?.payment_method ?? null,
        expense_status: existing?.expense_status ?? 'Pending',
        notes: existing?.notes ?? '',
    };
}

export function OperationalForm({ existing }: { existing?: OperationalRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'admin_log.operational',
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
            // Reporting month → first of month ISO date.
            const mm = String(parsed.data.reporting_month_month).padStart(2, '0');
            const reportingMonthIso = `${parsed.data.reporting_month_year}-${mm}-01`;

            const payload: OperationalInput = {
                reporting_month: reportingMonthIso,
                department: parsed.data.department || null,
                expense_category: parsed.data.expense_category || null,
                expense_subcategory: parsed.data.expense_subcategory || null,
                transaction_date: parsed.data.transaction_date || null,
                period_start: parsed.data.period_start || null,
                period_end: parsed.data.period_end || null,
                vendor_or_payee: parsed.data.vendor_or_payee || null,
                related_po_id: parsed.data.related_po_id,
                description: parsed.data.description || null,
                currency: parsed.data.currency,
                amount: parsed.data.amount,
                payment_method: (parsed.data.payment_method as PaymentMethod | null | '') || null,
                expense_status: parsed.data.expense_status,
                notes: parsed.data.notes || null,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await operationalApi.update(existing.id, payload);
                toast.success('Operational record updated');
            } else {
                await operationalApi.create(payload);
                toast.success('Operational record created');
            }
            draft.clearDraft();
            router.replace('/admin-log/operational');
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

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Reporting Month" name="reporting_month" required>
                    <MonthPicker
                        value={{
                            month: values.reporting_month_month,
                            year: values.reporting_month_year,
                        }}
                        onChange={(next) => {
                            form.setValue('reporting_month_month', next.month ?? 1);
                            form.setValue('reporting_month_year', next.year ?? new Date().getFullYear());
                        }}
                    />
                </FormField>
                <FormField label="Department" name="department">
                    <Input {...form.register('department')} />
                </FormField>
                <FormField label="Expense Category" name="expense_category">
                    <Input {...form.register('expense_category')} />
                </FormField>
                <FormField label="Subcategory" name="expense_subcategory">
                    <Input {...form.register('expense_subcategory')} />
                </FormField>
                <FormField label="Transaction Date" name="transaction_date">
                    <Controller
                        name="transaction_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Period (optional)" name="period_range">
                    <DateRangePicker
                        from={values.period_start || null}
                        to={values.period_end || null}
                        onChange={({ from, to }) => {
                            form.setValue('period_start', from || '');
                            form.setValue('period_end', to || '');
                        }}
                    />
                </FormField>
                <FormField label="Vendor / Payee" name="vendor_or_payee">
                    <Input {...form.register('vendor_or_payee')} />
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
                <FormField label="Amount" name="amount">
                    <Controller
                        name="amount"
                        control={form.control}
                        render={({ field }) => (
                            <CurrencyInput
                                value={field.value}
                                onChange={field.onChange}
                                currency={values.currency}
                                onCurrencyChange={(c) => form.setValue('currency', c)}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Payment Method" name="payment_method">
                    <select
                        {...form.register('payment_method')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                </FormField>
                <FormField label="Expense Status" name="expense_status">
                    <select
                        {...form.register('expense_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {expenseStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="Description" name="description" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('description')}
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
                    entityModule="admin_log.operational"
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

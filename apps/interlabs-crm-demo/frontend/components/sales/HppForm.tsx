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
import { hppApi } from '@/lib/sales-api';
import type {
    Currency, HargaPokokPenjualan, HargaPokokPenjualanInput, HppItem,
} from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';
import { ItemListEditor, type HppLineItem } from './ItemListEditor';

const schema = z.object({
    customer_id: z.string().uuid().nullable(),
    related_quotation_id: z.string().uuid().nullable(),
    hpp_date: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: HargaPokokPenjualan): FormValues {
    return {
        customer_id: existing?.customer_id ?? null,
        related_quotation_id: existing?.related_quotation_id ?? null,
        hpp_date: existing?.hpp_date ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        notes: existing?.notes ?? '',
    };
}

export function HppForm({ existing }: { existing?: HargaPokokPenjualan }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [items, setItems] = useState<HppLineItem[]>(
        (existing?.item_list as HppLineItem[] | undefined) ?? [],
    );

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<{ form: FormValues; items: HppLineItem[] }>({
        formKey: 'sales.hpp',
        recordId: existing?.id ?? 'new',
        currentValues: { form: values, items },
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    // Derived totals.
    const totals = useMemo(() => {
        const total_cost = items.reduce(
            (acc, r) => acc + (r.cost_price || 0) * (r.qty || 0), 0,
        );
        const total_selling_price = items.reduce(
            (acc, r) => acc + (r.selling_price || 0) * (r.qty || 0), 0,
        );
        const gross_margin_total = total_selling_price - total_cost;
        return { total_cost, total_selling_price, gross_margin_total };
    }, [items]);

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            // Recompute per-line margin before send.
            const item_list: HppItem[] = items.map((r) => {
                const margin_amount = (r.selling_price || 0) - (r.cost_price || 0);
                const margin_percent = r.selling_price
                    ? (margin_amount / r.selling_price) * 100
                    : 0;
                return { ...r, margin_amount, margin_percent };
            });
            const payload: HargaPokokPenjualanInput = {
                ...parsed.data,
                hpp_date: parsed.data.hpp_date || null,
                item_list,
                total_cost: totals.total_cost,
                total_selling_price: totals.total_selling_price,
                gross_margin_total: totals.gross_margin_total,
                workflow_status: existing?.workflow_status ?? 'draft',
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await hppApi.update(existing.id, payload);
                toast.success('HPP updated');
            } else {
                await hppApi.create(payload);
                toast.success('HPP created');
            }
            draft.clearDraft();
            router.replace('/sales/hpp');
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
                <FormField label="HPP Date" name="hpp_date">
                    <Controller
                        name="hpp_date"
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
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium">Line Items</p>
                <ItemListEditor kind="hpp" value={items} onChange={setItems} />
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between">
                    <span>Total Cost</span>
                    <span>{formatCurrency(totals.total_cost, values.currency)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Total Selling</span>
                    <span>{formatCurrency(totals.total_selling_price, values.currency)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                    <span>Gross Margin</span>
                    <span>{formatCurrency(totals.gross_margin_total, values.currency)}</span>
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
                    entityModule="sales.hpp"
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

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
import { CurrencyInput } from '@/components/shared/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { forecastsApi } from '@/lib/sales-api';
import type { SalesForecast, SalesForecastInput, ForecastStage, Currency } from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';

const stages: ForecastStage[] = [
    'Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost',
];

const schema = z.object({
    customer_id: z.string().uuid().nullable(),
    product_or_service_name: z.string().min(1, 'Required').max(500),
    description: z.string().optional().nullable(),
    forecast_period_start: z.string().nullable().optional(),
    forecast_period_end: z.string().nullable().optional(),
    currency: z.enum(['IDR', 'USD', 'EUR']),
    estimated_value: z.number().nonnegative().nullable(),
    probability_percent: z.number().min(0).max(100).nullable(),
    stage: z.enum(stages as [ForecastStage, ...ForecastStage[]]),
    expected_close_date: z.string().nullable().optional(),
    pic_user_id: z.string().uuid().nullable(),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: SalesForecast): FormValues {
    return {
        customer_id: existing?.customer_id ?? null,
        product_or_service_name: existing?.product_or_service_name ?? '',
        description: existing?.description ?? '',
        forecast_period_start: existing?.forecast_period_start ?? '',
        forecast_period_end: existing?.forecast_period_end ?? '',
        currency: (existing?.currency as Currency) ?? 'IDR',
        estimated_value: existing?.estimated_value ?? null,
        probability_percent: existing?.probability_percent ?? null,
        stage: existing?.stage ?? 'Prospect',
        expected_close_date: existing?.expected_close_date ?? '',
        pic_user_id: existing?.pic_user_id ?? null,
        notes: existing?.notes ?? '',
    };
}

export function SalesForecastForm({ existing }: { existing?: SalesForecast }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'sales.forecast',
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
            const payload: SalesForecastInput = {
                ...parsed.data,
                forecast_period_start: parsed.data.forecast_period_start || null,
                forecast_period_end: parsed.data.forecast_period_end || null,
                expected_close_date: parsed.data.expected_close_date || null,
                workflow_status: existing?.workflow_status ?? 'draft',
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await forecastsApi.update(existing.id, payload);
                toast.success('Forecast updated');
            } else {
                await forecastsApi.create(payload);
                toast.success('Forecast created');
            }
            draft.clearDraft();
            router.replace('/sales/forecasts');
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
                    label="Product / Service" name="product_or_service_name" required
                    error={form.formState.errors.product_or_service_name?.message}
                >
                    <Input {...form.register('product_or_service_name', { required: true })} />
                </FormField>
                <FormField label="Description" name="description" className="md:col-span-2">
                    <textarea
                        rows={2}
                        {...form.register('description')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField label="Period Start" name="forecast_period_start">
                    <Controller
                        name="forecast_period_start"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Period End" name="forecast_period_end">
                    <Controller
                        name="forecast_period_end"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="Estimated Value" name="estimated_value">
                    <Controller
                        name="estimated_value"
                        control={form.control}
                        render={({ field }) => (
                            <CurrencyInput
                                value={field.value}
                                onChange={field.onChange}
                                currency={form.watch('currency')}
                                onCurrencyChange={(c) => form.setValue('currency', c)}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Probability %" name="probability_percent">
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        {...form.register('probability_percent', { valueAsNumber: true })}
                    />
                </FormField>
                <FormField label="Stage" name="stage">
                    <select
                        {...form.register('stage')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="Expected Close" name="expected_close_date">
                    <Controller
                        name="expected_close_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker value={field.value} onChange={field.onChange} />
                        )}
                    />
                </FormField>
                <FormField label="PIC" name="pic_user_id" className="md:col-span-2">
                    <Controller
                        name="pic_user_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/users"
                                labelKey="display_name"
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
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
                    entityModule="sales.forecasts"
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

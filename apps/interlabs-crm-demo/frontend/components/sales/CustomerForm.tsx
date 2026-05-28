'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { customersApi } from '@/lib/sales-api';
import type { Customer, CustomerInput } from '@/lib/sales-types';

import { DraftBanner } from './DraftBanner';
import { FormActions } from './FormActions';

/**
 * Customer create/edit form. Re-used by `/sales/customers/new` and
 * `/sales/customers/[id]/edit`. When `existing` is provided, the form
 * pre-fills and PUTs; otherwise it POSTs a new record.
 */

const schema = z.object({
    company_name: z.string().min(1, 'Company name is required').max(500),
    trade_name: z.string().max(500).optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().max(200).optional().nullable(),
    country: z.string().max(200).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email('Invalid email').optional().or(z.literal('')).nullable(),
    website: z.string().max(300).optional().nullable(),
    npwp: z.string().max(50).optional().nullable(),
    pic_name: z.string().max(300).optional().nullable(),
    pic_phone: z.string().max(50).optional().nullable(),
    pic_email: z.string().email('Invalid PIC email').optional().or(z.literal('')).nullable(),
    customer_status: z.enum(['Active', 'Inactive']),
    notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function defaultValues(existing?: Customer): FormValues {
    return {
        company_name: existing?.company_name ?? '',
        trade_name: existing?.trade_name ?? '',
        address: existing?.address ?? '',
        city: existing?.city ?? '',
        country: existing?.country ?? '',
        phone: existing?.phone ?? '',
        email: existing?.email ?? '',
        website: existing?.website ?? '',
        npwp: existing?.npwp ?? '',
        pic_name: existing?.pic_name ?? '',
        pic_phone: existing?.pic_phone ?? '',
        pic_email: existing?.pic_email ?? '',
        customer_status: existing?.customer_status ?? 'Active',
        notes: existing?.notes ?? '',
    };
}

export function CustomerForm({ existing }: { existing?: Customer }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({
        defaultValues: defaultValues(existing),
    });

    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'sales.customer',
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    useEffect(() => {
        // Auto-hide the banner once the form data is dirty (user chose to start
        // fresh) or once the user resumes the draft. We only show it initially.
        if (form.formState.isDirty) setBannerSeen(true);
    }, [form.formState.isDirty]);

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Please fix validation errors');
            return;
        }
        setSubmitting(true);
        try {
            const payload: CustomerInput = {
                ...parsed.data,
                email: parsed.data.email || null,
                pic_email: parsed.data.pic_email || null,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await customersApi.update(existing.id, payload);
                toast.success('Customer updated');
            } else {
                await customersApi.create(payload);
                toast.success('Customer created');
            }
            draft.clearDraft();
            router.replace('/sales/customers');
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
                    onDiscard={() => {
                        draft.clearDraft();
                        setBannerSeen(true);
                    }}
                />
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <FormField
                    label="Company Name" name="company_name" required
                    error={form.formState.errors.company_name?.message}
                >
                    <Input {...form.register('company_name', { required: true })} />
                </FormField>
                <FormField label="Trade Name" name="trade_name">
                    <Input {...form.register('trade_name')} />
                </FormField>
                <FormField label="Email" name="email" error={form.formState.errors.email?.message}>
                    <Input type="email" {...form.register('email')} />
                </FormField>
                <FormField label="Phone" name="phone">
                    <Input {...form.register('phone')} />
                </FormField>
                <FormField label="Website" name="website">
                    <Input {...form.register('website')} />
                </FormField>
                <FormField label="NPWP" name="npwp" hint="Indonesian tax ID">
                    <Input {...form.register('npwp')} />
                </FormField>
                <FormField label="Country" name="country">
                    <Input {...form.register('country')} />
                </FormField>
                <FormField label="City" name="city">
                    <Input {...form.register('city')} />
                </FormField>
                <FormField label="Status" name="customer_status">
                    <select
                        {...form.register('customer_status')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </FormField>
                <FormField label="Address" name="address" className="md:col-span-2">
                    <textarea
                        {...form.register('address')}
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
                <FormField
                    label="PIC Name" name="pic_name"
                    hint="Primary contact person"
                >
                    <Input {...form.register('pic_name')} />
                </FormField>
                <FormField label="PIC Phone" name="pic_phone">
                    <Input {...form.register('pic_phone')} />
                </FormField>
                <FormField label="PIC Email" name="pic_email" error={form.formState.errors.pic_email?.message}>
                    <Input type="email" {...form.register('pic_email')} />
                </FormField>
                <FormField label="Notes" name="notes" className="md:col-span-2">
                    <textarea
                        {...form.register('notes')}
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            </div>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="sales.customers"
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

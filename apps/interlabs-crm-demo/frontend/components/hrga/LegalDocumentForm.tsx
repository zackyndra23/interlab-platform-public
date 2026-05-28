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
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { legalDocumentsApi } from '@/lib/hrga-api';
import {
    LEGAL_DOCUMENT_CATEGORIES, LEGAL_STATUSES,
} from '@/lib/hrga-ui';
import type {
    DocumentAccessScope, LegalDocument, LegalDocumentCreateInput,
    LegalDocumentStatus, LegalDocumentSupersedeInput,
} from '@/lib/hrga-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Legalitas document form. Drives both create and edit. When `mode="supersede"`
 * the form is prefilled from the existing record but submits to the
 * /legal-documents/:id/supersede endpoint — the server inserts a new Active
 * row and marks the previous row Superseded in the same transaction.
 *
 * Mutations are blocked server-side once document_status is Superseded or
 * Archived; we mirror that here by rendering a read-only banner.
 */

const accessScopes: DocumentAccessScope[] = ['hrga_only', 'all_roles', 'specific_roles'];

const schema = z.object({
    document_name: z.string().min(1, 'Document name is required').max(500),
    document_category: z.string().nullable().optional(),
    document_subcategory: z.string().nullable().optional(),
    document_number: z.string().nullable().optional(),
    document_year: z.preprocess(
        (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v),
        z.union([z.number().int().min(1900).max(9999), z.null()]),
    ),
    issue_date: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    validity_period_start: z.string().nullable().optional(),
    validity_period_end: z.string().nullable().optional(),
    notary_name: z.string().nullable().optional(),
    related_customer_id: z.string().uuid().nullable(),
    related_principal: z.string().nullable().optional(),
    pic_user_id: z.string().uuid().nullable(),
    version_number: z.string().nullable().optional(),
    document_status: z.enum(
        LEGAL_STATUSES as [LegalDocumentStatus, ...LegalDocumentStatus[]],
    ),
    tags_text: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    access_scope: z.enum(
        accessScopes as [DocumentAccessScope, ...DocumentAccessScope[]],
    ),
    supersede_reason: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;
type FormMode = 'create' | 'edit' | 'supersede';

function defaults(existing?: LegalDocument, mode: FormMode = 'create'): FormValues {
    return {
        document_name: existing?.document_name ?? '',
        document_category: existing?.document_category ?? '',
        document_subcategory: existing?.document_subcategory ?? '',
        document_number: existing?.document_number ?? '',
        document_year: existing?.document_year ?? null,
        issue_date: existing?.issue_date ?? '',
        expiry_date: existing?.expiry_date ?? '',
        validity_period_start: existing?.validity_period_start ?? '',
        validity_period_end: existing?.validity_period_end ?? '',
        notary_name: existing?.notary_name ?? '',
        related_customer_id: existing?.related_customer_id ?? null,
        related_principal: existing?.related_principal ?? '',
        pic_user_id: existing?.pic_user_id ?? null,
        version_number: mode === 'supersede' ? '' : (existing?.version_number ?? ''),
        document_status: mode === 'supersede'
            ? 'Active'
            : (existing?.document_status ?? 'Draft'),
        tags_text: existing?.tags?.join(', ') ?? '',
        notes: existing?.notes ?? '',
        access_scope: existing?.access_scope ?? 'hrga_only',
        supersede_reason: '',
    };
}

function parseTags(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    const list = raw.split(',').map((t) => t.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
}

export function LegalDocumentForm({
    existing, mode = 'create',
}: {
    existing?: LegalDocument;
    mode?: FormMode;
}) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing, mode) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: `hrga.legalitas.${mode}`,
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const isReadOnly = mode === 'edit' && !!existing
        && (existing.document_status === 'Superseded'
            || existing.document_status === 'Archived');

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const tags = parseTags(parsed.data.tags_text);
            const corePayload: LegalDocumentCreateInput = {
                document_name: parsed.data.document_name,
                document_category: parsed.data.document_category || null,
                document_subcategory: parsed.data.document_subcategory || null,
                document_number: parsed.data.document_number || null,
                document_year: parsed.data.document_year
                    && Number.isFinite(parsed.data.document_year)
                    ? parsed.data.document_year : null,
                issue_date: parsed.data.issue_date || null,
                expiry_date: parsed.data.expiry_date || null,
                validity_period_start: parsed.data.validity_period_start || null,
                validity_period_end: parsed.data.validity_period_end || null,
                notary_name: parsed.data.notary_name || null,
                related_customer_id: parsed.data.related_customer_id,
                related_principal: parsed.data.related_principal || null,
                pic_user_id: parsed.data.pic_user_id,
                version_number: parsed.data.version_number || null,
                document_status: parsed.data.document_status,
                tags,
                notes: parsed.data.notes || null,
                access_scope: parsed.data.access_scope,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };

            if (mode === 'supersede' && existing) {
                const supersedePayload: LegalDocumentSupersedeInput = {
                    ...corePayload,
                    supersede_reason: parsed.data.supersede_reason || null,
                };
                const result = await legalDocumentsApi.supersede(existing.id, supersedePayload);
                toast.success('New version created; previous marked Superseded.');
                draft.clearDraft();
                router.replace(`/hrga/legalitas/${result.current.id}`);
            } else if (existing) {
                await legalDocumentsApi.update(existing.id, corePayload);
                toast.success('Legal document updated');
                draft.clearDraft();
                router.replace(`/hrga/legalitas/${existing.id}`);
            } else {
                const created = await legalDocumentsApi.create(corePayload);
                toast.success('Legal document created');
                draft.clearDraft();
                router.replace(`/hrga/legalitas/${created.id}`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSubmitting(false);
        }
    }

    const submitLabel = mode === 'supersede'
        ? 'Create New Version' : existing ? 'Save' : 'Create';

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

            {isReadOnly && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    This document is {existing?.document_status}. Create a new version via Supersede to make further changes.
                </p>
            )}

            {mode === 'supersede' && (
                <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs text-primary">
                    Creating a new Active version. The current record will be marked Superseded once this form submits.
                </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Document Name" name="document_name" required
                    error={form.formState.errors.document_name?.message}>
                    <Input disabled={isReadOnly} {...form.register('document_name')} />
                </FormField>
                <FormField label="Document Number" name="document_number">
                    <Input disabled={isReadOnly} {...form.register('document_number')} />
                </FormField>

                <FormField label="Category" name="document_category">
                    <select
                        {...form.register('document_category')}
                        disabled={isReadOnly}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {LEGAL_DOCUMENT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Subcategory" name="document_subcategory">
                    <Input disabled={isReadOnly} {...form.register('document_subcategory')} />
                </FormField>

                <FormField label="Document Year" name="document_year">
                    <Input
                        type="number"
                        min={1900}
                        max={9999}
                        disabled={isReadOnly}
                        {...form.register('document_year', { valueAsNumber: true })}
                    />
                </FormField>
                <FormField label="Version Number" name="version_number"
                    hint="Optional. For supersede use the new version label (e.g. v2.0).">
                    <Input disabled={isReadOnly} {...form.register('version_number')} />
                </FormField>

                <FormField label="Issue Date" name="issue_date">
                    <Controller
                        name="issue_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Expiry Date" name="expiry_date"
                    hint="Sets 90d/30d reminder anchors automatically.">
                    <Controller
                        name="expiry_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Validity Period Start" name="validity_period_start">
                    <Controller
                        name="validity_period_start"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Validity Period End" name="validity_period_end">
                    <Controller
                        name="validity_period_end"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Notary Name" name="notary_name">
                    <Input disabled={isReadOnly} {...form.register('notary_name')} />
                </FormField>
                <FormField label="Related Principal" name="related_principal"
                    hint="For LOA and similar — the principal party.">
                    <Input disabled={isReadOnly} {...form.register('related_principal')} />
                </FormField>

                <FormField label="Related Customer" name="related_customer_id">
                    <Controller
                        name="related_customer_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/sales/customers"
                                labelKey="company_name"
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>
                <FormField label="PIC" name="pic_user_id">
                    <Controller
                        name="pic_user_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/users"
                                labelKey="display_name"
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isReadOnly}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Status" name="document_status"
                    hint="'Expired' / 'Archived' are normally set by the system or archive action.">
                    <select
                        {...form.register('document_status')}
                        disabled={isReadOnly || mode === 'supersede'}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {LEGAL_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Access Scope" name="access_scope"
                    hint="Controls Smart Search visibility for non-HRGA roles.">
                    <select
                        {...form.register('access_scope')}
                        disabled={isReadOnly}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="hrga_only">HRGA only</option>
                        <option value="all_roles">All roles</option>
                        <option value="specific_roles">Specific roles</option>
                    </select>
                </FormField>
            </div>

            <FormField label="Tags" name="tags_text"
                hint="Comma-separated (e.g. compliance, annual).">
                <Input disabled={isReadOnly} {...form.register('tags_text')} />
            </FormField>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    disabled={isReadOnly}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            {mode === 'supersede' && (
                <FormField label="Supersede Reason" name="supersede_reason"
                    hint="Stored on the new version for audit context.">
                    <textarea
                        rows={2}
                        {...form.register('supersede_reason')}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                </FormField>
            )}

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="hrga.legal_documents"
                    entityId={mode === 'supersede' ? undefined : existing?.id}
                    onChange={setAttachmentIds}
                    disabled={isReadOnly}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={submitLabel}
                submitting={submitting || isReadOnly}
            />
        </form>
    );
}

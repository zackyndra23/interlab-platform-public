'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { archiveApi } from '@/lib/hrga-api';
import { ARCHIVE_REASONS } from '@/lib/hrga-ui';
import type {
    ArchiveAccessScope, ArchiveCreateInput, ArchiveReason, ArchiveRecord,
    ArchiveSourceModule,
} from '@/lib/hrga-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Direct-entry archive form for records that live outside the Legalitas /
 * Company Letter tables (source_module='other') or for manual mirror
 * creation. When source_module is 'legalitas' or 'company_letters' the
 * backend also flips the source row's status to Archived.
 *
 * The normal archive flow from a document uses ArchiveDocumentForm (which
 * calls the dedicated /:id/archive endpoints); this form is for ad-hoc
 * archive creation only.
 */

const accessScopes: ArchiveAccessScope[] = ['hrga_only', 'all_roles'];
const sources: ArchiveSourceModule[] = ['legalitas', 'company_letters', 'other'];

const schema = z.object({
    source_module: z.enum(sources as [ArchiveSourceModule, ...ArchiveSourceModule[]]),
    source_record_id: z.string().uuid('Source record is required'),
    document_name: z.string().nullable().optional(),
    document_category: z.string().nullable().optional(),
    archive_reason: z.enum(ARCHIVE_REASONS as [ArchiveReason, ...ArchiveReason[]]),
    notes: z.string().max(2000).nullable().optional(),
    access_scope: z.enum(accessScopes as [ArchiveAccessScope, ...ArchiveAccessScope[]]),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: ArchiveRecord): FormValues {
    return {
        source_module: existing?.source_module ?? 'other',
        source_record_id: existing?.source_record_id ?? '',
        document_name: existing?.document_name ?? '',
        document_category: existing?.document_category ?? '',
        archive_reason: existing?.archive_reason ?? 'Superseded',
        notes: existing?.notes ?? '',
        access_scope: existing?.access_scope ?? 'hrga_only',
    };
}

export function ArchiveRecordForm({ existing }: { existing?: ArchiveRecord }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const source = form.watch('source_module');
    const draft = useFormDraft<FormValues>({
        formKey: 'hrga.archive',
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
            if (existing) {
                await archiveApi.update(existing.id, {
                    document_name: parsed.data.document_name || null,
                    document_category: parsed.data.document_category || null,
                    archive_reason: parsed.data.archive_reason,
                    notes: parsed.data.notes || null,
                    access_scope: parsed.data.access_scope,
                });
                toast.success('Archive record updated');
                draft.clearDraft();
                router.replace(`/hrga/archive/${existing.id}`);
            } else {
                const payload: ArchiveCreateInput = {
                    source_module: parsed.data.source_module,
                    source_record_id: parsed.data.source_record_id,
                    document_name: parsed.data.document_name || null,
                    document_category: parsed.data.document_category || null,
                    archive_reason: parsed.data.archive_reason,
                    notes: parsed.data.notes || null,
                    access_scope: parsed.data.access_scope,
                    attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
                };
                const created = await archiveApi.create(payload);
                toast.success('Archive entry created');
                draft.clearDraft();
                router.replace(`/hrga/archive/${created.id}`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSubmitting(false);
        }
    }

    const sourceEndpoint = source === 'legalitas'
        ? '/api/hrga/legal-documents'
        : source === 'company_letters'
            ? '/api/hrga/company-letters'
            : null;
    const sourceLabelKey = source === 'legalitas'
        ? 'document_name' : source === 'company_letters' ? 'subject' : 'id';

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
                <FormField label="Source Module" name="source_module" required>
                    <select
                        {...form.register('source_module')}
                        disabled={!!existing}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {sources.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Source Record" name="source_record_id" required
                    error={form.formState.errors.source_record_id?.message}>
                    {sourceEndpoint && !existing ? (
                        <Controller
                            name="source_record_id"
                            control={form.control}
                            render={({ field }) => (
                                <SearchDropdown
                                    endpoint={sourceEndpoint}
                                    labelKey={sourceLabelKey}
                                    value={field.value}
                                    onChange={(v) => field.onChange(v || '')}
                                />
                            )}
                        />
                    ) : (
                        <Input
                            disabled={!!existing}
                            placeholder="UUID of the source record"
                            {...form.register('source_record_id')}
                        />
                    )}
                </FormField>

                <FormField label="Document Name" name="document_name"
                    hint="Optional override. Falls back to the source record's name if blank.">
                    <Input {...form.register('document_name')} />
                </FormField>
                <FormField label="Category" name="document_category">
                    <Input {...form.register('document_category')} />
                </FormField>

                <FormField label="Archive Reason" name="archive_reason" required>
                    <select
                        {...form.register('archive_reason')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {ARCHIVE_REASONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Access Scope" name="access_scope">
                    <select
                        {...form.register('access_scope')}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="hrga_only">HRGA only</option>
                        <option value="all_roles">All roles</option>
                    </select>
                </FormField>
            </div>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            {!existing && (
                <div>
                    <p className="mb-1 text-sm font-medium">Attachments</p>
                    <MultiFileUpload
                        entityModule="hrga.archive"
                        onChange={setAttachmentIds}
                    />
                </div>
            )}

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Create'}
                submitting={submitting}
            />
        </form>
    );
}

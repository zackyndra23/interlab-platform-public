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
import { companyLettersApi } from '@/lib/hrga-api';
import { LETTER_TYPES, LETTER_STATUSES } from '@/lib/hrga-ui';
import type {
    CompanyLetter, CompanyLetterCreateInput, DocumentAccessScope, LetterStatus,
} from '@/lib/hrga-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Company letter form. The free-form `letter_status` selector here only
 * lets the user sit at Draft while authoring. Progression to Under Review
 * / Final / Sent is done via the dedicated transition panel on the detail
 * page (LetterTransitionPanel) because the server enforces a forward-only
 * ORDER check and emits notifications on specific transitions.
 */

const accessScopes: DocumentAccessScope[] = ['hrga_only', 'all_roles', 'specific_roles'];
const manualStatuses: LetterStatus[] = ['Draft', 'Under Review', 'Final', 'Sent'];

const schema = z.object({
    subject: z.string().min(1, 'Subject is required').max(500),
    letter_type: z.string().nullable().optional(),
    letter_number: z.string().nullable().optional(),
    related_employee_id: z.string().uuid().nullable(),
    recipient_name: z.string().nullable().optional(),
    recipient_role_or_department: z.string().nullable().optional(),
    issue_date: z.string().nullable().optional(),
    effective_date: z.string().nullable().optional(),
    reference_number: z.string().nullable().optional(),
    signatory_user_id: z.string().uuid().nullable(),
    template_reference_id: z.string().uuid().nullable(),
    letter_status: z.enum(manualStatuses as [LetterStatus, ...LetterStatus[]]),
    tags_text: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    access_scope: z.enum(accessScopes as [DocumentAccessScope, ...DocumentAccessScope[]]),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: CompanyLetter): FormValues {
    const existingStatus: LetterStatus = existing?.letter_status && existing.letter_status !== 'Archived'
        ? existing.letter_status
        : 'Draft';
    return {
        subject: existing?.subject ?? '',
        letter_type: existing?.letter_type ?? '',
        letter_number: existing?.letter_number ?? '',
        related_employee_id: existing?.related_employee_id ?? null,
        recipient_name: existing?.recipient_name ?? '',
        recipient_role_or_department: existing?.recipient_role_or_department ?? '',
        issue_date: existing?.issue_date ?? '',
        effective_date: existing?.effective_date ?? '',
        reference_number: existing?.reference_number ?? '',
        signatory_user_id: existing?.signatory_user_id ?? null,
        template_reference_id: existing?.template_reference_id ?? null,
        letter_status: existingStatus,
        tags_text: existing?.tags?.join(', ') ?? '',
        notes: existing?.notes ?? '',
        access_scope: existing?.access_scope ?? 'hrga_only',
    };
}

function parseTags(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    const list = raw.split(',').map((t) => t.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
}

export function CompanyLetterForm({ existing }: { existing?: CompanyLetter }) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: 'hrga.company_letters',
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);
    const isArchived = existing?.letter_status === 'Archived';

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            const tags = parseTags(parsed.data.tags_text);
            const payload: CompanyLetterCreateInput = {
                subject: parsed.data.subject,
                letter_type: parsed.data.letter_type || null,
                letter_number: parsed.data.letter_number || null,
                related_employee_id: parsed.data.related_employee_id,
                recipient_name: parsed.data.recipient_name || null,
                recipient_role_or_department: parsed.data.recipient_role_or_department || null,
                issue_date: parsed.data.issue_date || null,
                effective_date: parsed.data.effective_date || null,
                reference_number: parsed.data.reference_number || null,
                signatory_user_id: parsed.data.signatory_user_id,
                template_reference_id: parsed.data.template_reference_id,
                letter_status: parsed.data.letter_status,
                tags,
                notes: parsed.data.notes || null,
                access_scope: parsed.data.access_scope,
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
            };
            if (existing) {
                await companyLettersApi.update(existing.id, payload);
                toast.success('Letter updated');
                draft.clearDraft();
                router.replace(`/hrga/company-letters/${existing.id}`);
            } else {
                const created = await companyLettersApi.create(payload);
                toast.success('Letter created');
                draft.clearDraft();
                router.replace(`/hrga/company-letters/${created.id}`);
            }
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

            {isArchived && (
                <p className="rounded-md border border-muted bg-muted p-2 text-xs text-muted-foreground">
                    Archived letters are read-only.
                </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Subject" name="subject" required
                    error={form.formState.errors.subject?.message}
                    className="md:col-span-2">
                    <Input disabled={isArchived} {...form.register('subject')} />
                </FormField>

                <FormField label="Letter Type" name="letter_type">
                    <select
                        {...form.register('letter_type')}
                        disabled={isArchived}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">—</option>
                        {LETTER_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Letter Number" name="letter_number"
                    hint="Formal letter number (e.g. 001/HRGA/IV/2026).">
                    <Input disabled={isArchived} {...form.register('letter_number')} />
                </FormField>

                <FormField label="Related Employee" name="related_employee_id">
                    <Controller
                        name="related_employee_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/users"
                                labelKey="display_name"
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isArchived}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Signatory" name="signatory_user_id">
                    <Controller
                        name="signatory_user_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/users"
                                labelKey="display_name"
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isArchived}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Recipient Name" name="recipient_name">
                    <Input disabled={isArchived} {...form.register('recipient_name')} />
                </FormField>
                <FormField label="Recipient Role / Dept." name="recipient_role_or_department">
                    <Input disabled={isArchived} {...form.register('recipient_role_or_department')} />
                </FormField>

                <FormField label="Issue Date" name="issue_date">
                    <Controller
                        name="issue_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isArchived}
                            />
                        )}
                    />
                </FormField>
                <FormField label="Effective Date" name="effective_date">
                    <Controller
                        name="effective_date"
                        control={form.control}
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isArchived}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Reference Number" name="reference_number"
                    hint="For replies or references to a prior letter.">
                    <Input disabled={isArchived} {...form.register('reference_number')} />
                </FormField>
                <FormField label="Template" name="template_reference_id">
                    <Controller
                        name="template_reference_id"
                        control={form.control}
                        render={({ field }) => (
                            <SearchDropdown
                                endpoint="/api/hrga/letter-templates"
                                labelKey="template_name"
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isArchived}
                            />
                        )}
                    />
                </FormField>

                <FormField label="Status" name="letter_status"
                    hint="Progression to Under Review / Final / Sent is also available from the detail page.">
                    <select
                        {...form.register('letter_status')}
                        disabled={isArchived}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {LETTER_STATUSES.filter((s) => s !== 'Archived').map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Access Scope" name="access_scope"
                    hint="Controls visibility outside HRGA in Smart Search.">
                    <select
                        {...form.register('access_scope')}
                        disabled={isArchived}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="hrga_only">HRGA only</option>
                        <option value="all_roles">All roles</option>
                        <option value="specific_roles">Specific roles</option>
                    </select>
                </FormField>
            </div>

            <FormField label="Tags" name="tags_text"
                hint="Comma-separated.">
                <Input disabled={isArchived} {...form.register('tags_text')} />
            </FormField>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    disabled={isArchived}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Attachments</p>
                <MultiFileUpload
                    entityModule="hrga.company_letters"
                    entityId={existing?.id}
                    onChange={setAttachmentIds}
                    disabled={isArchived}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={existing ? 'Save' : 'Create'}
                submitting={submitting || isArchived}
            />
        </form>
    );
}

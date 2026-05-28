'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/shared/FormField';
import { companyLettersApi, legalDocumentsApi } from '@/lib/hrga-api';
import { ARCHIVE_REASONS } from '@/lib/hrga-ui';
import type {
    ArchiveAccessScope, ArchiveReason, CompanyLetter, LegalDocument,
} from '@/lib/hrga-types';

/**
 * Submits POST /legal-documents/:id/archive or POST /company-letters/:id/archive.
 * Both endpoints mirror the row into hrga_archive_records + flip the source
 * row's status to 'Archived' in a single transaction. After success the user
 * is routed to the Archive detail page.
 */

const accessScopes: ArchiveAccessScope[] = ['hrga_only', 'all_roles'];

const schema = z.object({
    archive_reason: z.enum(ARCHIVE_REASONS as [ArchiveReason, ...ArchiveReason[]]),
    notes: z.string().max(2000).nullable().optional(),
    access_scope: z.enum(accessScopes as [ArchiveAccessScope, ...ArchiveAccessScope[]]),
});

type FormValues = z.infer<typeof schema>;

export function ArchiveDocumentForm({
    source, record,
}: {
    source: 'legalitas' | 'company_letters';
    record: LegalDocument | CompanyLetter;
}) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);

    const form = useForm<FormValues>({
        defaultValues: {
            archive_reason: 'Superseded',
            notes: '',
            access_scope: 'hrga_only',
        },
    });

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        setSubmitting(true);
        try {
            if (source === 'legalitas') {
                const res = await legalDocumentsApi.archive(record.id, {
                    archive_reason: parsed.data.archive_reason,
                    notes: parsed.data.notes || null,
                    access_scope: parsed.data.access_scope,
                });
                toast.success('Document archived');
                router.replace(`/hrga/archive/${res.archive.id}`);
            } else {
                const res = await companyLettersApi.archive(record.id, {
                    archive_reason: parsed.data.archive_reason,
                    notes: parsed.data.notes || null,
                    access_scope: parsed.data.access_scope,
                });
                toast.success('Letter archived');
                router.replace(`/hrga/archive/${res.archive.id}`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Archive failed');
        } finally {
            setSubmitting(false);
        }
    }

    const name = 'document_name' in record ? record.document_name : record.subject;

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                This action moves {name} into the Archive repository and flips its source status to Archived.
            </p>

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

            <FormField label="Access Scope" name="access_scope"
                hint="Controls whether non-HRGA roles can see this record in Smart Search.">
                <select
                    {...form.register('access_scope')}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="hrga_only">HRGA only</option>
                    <option value="all_roles">All roles</option>
                </select>
            </FormField>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm"
                    onClick={() => router.back()} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="submit" size="sm" variant="danger" disabled={submitting}>
                    {submitting ? 'Archiving…' : 'Archive'}
                </Button>
            </div>
        </form>
    );
}

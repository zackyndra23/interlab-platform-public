'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/shared/FormField';
import { companyLettersApi } from '@/lib/hrga-api';
import { LETTER_STATUS_ORDER, letterStatusVariant } from '@/lib/hrga-ui';
import { StatusBadge } from '@/components/shared/StatusBadge';
import type { CompanyLetter, LetterStatus } from '@/lib/hrga-types';

const ALL_NON_ARCHIVE: LetterStatus[] = ['Draft', 'Under Review', 'Final', 'Sent'];

/**
 * Forward-only status transition panel. Mirrors the ORDER check in
 * hrga.service.js.transitionCompanyLetter so the UI hides rewinding
 * options. Hitting PUT /company-letters/:id/transition emits the
 * hrga.letter.review_requested or hrga.letter.finalized notification
 * on the matching status change.
 */
export function LetterTransitionPanel({
    letter, onTransitioned,
}: {
    letter: CompanyLetter;
    onTransitioned: () => void;
}) {
    const currentOrder = LETTER_STATUS_ORDER[letter.letter_status];
    const candidates = ALL_NON_ARCHIVE.filter(
        (s) => LETTER_STATUS_ORDER[s] >= currentOrder,
    );

    const [target, setTarget] = useState<LetterStatus>(letter.letter_status);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (letter.letter_status === 'Archived' || letter.letter_status === 'Sent') {
        return null;
    }

    async function submit(): Promise<void> {
        if (target === letter.letter_status) {
            toast.message('No status change selected');
            return;
        }
        setSubmitting(true);
        try {
            await companyLettersApi.transition(letter.id, {
                letter_status: target,
                note: note || null,
            });
            toast.success(`Letter moved to ${target}`);
            setNote('');
            onTransitioned();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Transition failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Workflow Transition</h3>
                <StatusBadge
                    status={letter.letter_status}
                    variant={letterStatusVariant(letter.letter_status)}
                />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Move To" name="target_status">
                    <select
                        value={target}
                        onChange={(e) => setTarget(e.target.value as LetterStatus)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        {candidates.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </FormField>
                <FormField label="Note" name="transition_note">
                    <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                </FormField>
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={submit} disabled={submitting}>
                    <Send size={14} />
                    {submitting ? 'Submitting…' : 'Transition'}
                </Button>
            </div>
        </section>
    );
}

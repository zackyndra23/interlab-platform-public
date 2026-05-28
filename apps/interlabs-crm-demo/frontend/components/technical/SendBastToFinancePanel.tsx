'use client';

import { useState } from 'react';
import { Handshake } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { bastApi } from '@/lib/technical-api';
import type { BastRecord } from '@/lib/technical-types';

/**
 * Inline panel on the BAST detail page. Fires the dedicated
 * /send-to-finance endpoint which atomically:
 *   - Binds any additional attachments.
 *   - Sets workflow_status='sent_to_finance', sent_to_finance=true.
 *   - Creates the Invoice Customer draft in Finance.
 *   - Advances the master PO to BAST.
 *   - Emits technical.bast.submitted + finance.invoice_customer.registered.
 */
export function SendBastToFinancePanel({
    bast, onSent,
}: {
    bast: BastRecord;
    onSent: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [note, setNote] = useState('');

    async function submit(): Promise<void> {
        if (!bast.related_po_id) {
            toast.error('BAST has no related master PO');
            return;
        }
        setSubmitting(true);
        try {
            await bastApi.sendToFinance(bast.id, {
                attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
                note: note.trim() || null,
            });
            toast.success('BAST sent to Finance — Invoice draft created, PO → BAST');
            await onSent();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Handoff failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Handshake size={14} />
                Send BAST to Finance
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Creates the Finance Invoice Customer draft and advances the master
                PO to <strong>BAST</strong>. This action is irreversible.
            </p>

            <FormField label="Note (optional)" name="note">
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>

            <div className="mt-3">
                <p className="mb-1 text-sm font-medium">Additional BAST attachments (optional)</p>
                <MultiFileUpload
                    entityModule="technical.bast"
                    entityId={bast.id}
                    onChange={setAttachmentIds}
                />
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Sending…' : 'Send to Finance'}
                </Button>
            </div>
        </section>
    );
}

'use client';

import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { installationsApi } from '@/lib/technical-api';
import type { DeliveryMethod, InstallationRecord } from '@/lib/technical-types';

/**
 * Inline panel on the Installation detail page. Fires the dedicated
 * /ready-to-deliver endpoint which atomically sets ready_to_deliver='Yes',
 * delivery_method, ready_to_deliver_at=now(), admin_log_response_status='pending'
 * and emits technical.installation.ready_to_deliver. Starts the 2-working-day
 * Admin & Log response SLA.
 */
export function ReadyToDeliverPanel({
    installation, onMarked,
}: {
    installation: InstallationRecord;
    onMarked: () => void | Promise<void>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [method, setMethod] = useState<DeliveryMethod>('Pick Up Forwarder');
    const [note, setNote] = useState('');

    async function submit(): Promise<void> {
        setSubmitting(true);
        try {
            await installationsApi.markReadyToDeliver(installation.id, {
                delivery_method: method,
                note: note.trim() || null,
            });
            toast.success('Ready-to-Deliver signalled to Admin & Log');
            await onMarked();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Mark failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <PackageCheck size={14} />
                Mark Ready to Deliver
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Notifies Admin &amp; Log and starts the 2-working-day response SLA.
                An escalation fires if the handoff is not acknowledged in time.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Delivery Method" name="delivery_method" required>
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as DeliveryMethod)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="Pick Up Forwarder">Pick Up Forwarder</option>
                        <option value="Hand Carry">Hand Carry</option>
                    </select>
                </FormField>
                <FormField label="Note (optional)" name="note">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={submitting} onClick={submit}>
                    {submitting ? 'Signalling…' : 'Send to Admin & Log'}
                </Button>
            </div>
        </section>
    );
}

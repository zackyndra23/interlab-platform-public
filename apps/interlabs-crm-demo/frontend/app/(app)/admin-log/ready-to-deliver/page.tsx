'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Truck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/shared/FormField';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { readyToDeliverApi } from '@/lib/admin-log-api';
import { rtdStatusVariant } from '@/lib/admin-log-ui';
import { formatDate, relativeTime } from '@/lib/utils';
import type {
    ReadyToDeliverEntry, ReadyToDeliverStatus,
} from '@/lib/admin-log-types';

/**
 * Ready-to-Deliver inbox for Admin & Log.
 *
 * Per MOD_admin_log §DEPENDENCY, Technical sets `ready_to_deliver=Yes`
 * on an Installation/Sparepart record; Admin & Log must acknowledge or
 * mark it dispatched within 2 working days or the SLA job fires
 * `admin_log.ready_to_deliver.overdue_response`.
 */
export default function ReadyToDeliverPage() {
    const [rows, setRows] = useState<ReadyToDeliverEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<ReadyToDeliverStatus | 'all'>('pending');

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const params = filter === 'all' ? {} : { admin_log_response_status: filter };
            const res = await readyToDeliverApi.list({ limit: 100, ...params });
            setRows(res.rows);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Ready to Deliver</h2>
                <div className="flex items-center gap-1 text-sm">
                    {(['pending', 'acknowledged', 'dispatched', 'all'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`rounded-md px-2 py-1 text-xs transition-colors ${
                                filter === f ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && rows.length === 0 && (
                <p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    Nothing in the {filter} queue.
                </p>
            )}

            <ul className="space-y-3">
                {rows.map((r) => (
                    <RtdCard key={r.id} entry={r} onAcknowledged={reload} />
                ))}
            </ul>
        </div>
    );
}

function RtdCard({
    entry, onAcknowledged,
}: {
    entry: ReadyToDeliverEntry;
    onAcknowledged: () => void | Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const [method, setMethod] = useState<'Pick Up Forwarder' | 'Hand Carry' | ''>(
        entry.delivery_method || '',
    );

    async function act(nextStatus: 'acknowledged' | 'dispatched'): Promise<void> {
        setBusy(true);
        try {
            await readyToDeliverApi.acknowledge(entry.id, {
                response_status: nextStatus,
                delivery_method: method || null,
                note: note || null,
            });
            toast.success(`Marked ${nextStatus}`);
            await onAcknowledged();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Acknowledge failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className="rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm font-semibold">
                        {entry.technical_job_order_number || '(no job order)'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        PO {entry.related_po_number || entry.related_po_id} · {entry.customer_name || '—'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Technical marked RTD {relativeTime(entry.ready_to_deliver_at)}
                        {entry.ready_to_deliver_at && (
                            <> · {formatDate(entry.ready_to_deliver_at, { withTime: true })}</>
                        )}
                    </p>
                </div>
                <StatusBadge
                    status={entry.admin_log_response_status}
                    variant={rtdStatusVariant(entry.admin_log_response_status)}
                />
            </div>

            {entry.admin_log_response_status === 'pending' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <FormField label="Delivery method" name="delivery_method">
                        <select
                            value={method}
                            onChange={(e) => setMethod(e.target.value as typeof method)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">—</option>
                            <option value="Pick Up Forwarder">Pick Up Forwarder</option>
                            <option value="Hand Carry">Hand Carry</option>
                        </select>
                    </FormField>
                    <FormField label="Note" name="note">
                        <Input value={note} onChange={(e) => setNote(e.target.value)} />
                    </FormField>
                    <div className="flex items-center gap-2 md:col-span-2">
                        <Button size="sm" variant="outline" disabled={busy}
                            onClick={() => act('acknowledged')}>
                            <CheckCircle2 size={14} /> Acknowledge
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => act('dispatched')}>
                            <Truck size={14} /> Mark Dispatched
                        </Button>
                    </div>
                </div>
            )}
        </li>
    );
}

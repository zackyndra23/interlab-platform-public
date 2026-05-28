'use client';
import { useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import { PO_STAGES, type POStage } from '@/lib/po-document-types';
import { toast } from 'sonner';

interface Props {
  poId: string;
  currentStage: POStage;
  onClose: () => void;
  onDone?: () => void;
}

export function AdminOverrideDialog({ poId, currentStage, onClose, onDone }: Props) {
  const [target, setTarget] = useState<POStage>(currentStage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim() || reason.length < 3) { toast.error('Reason required (min 3 chars)'); return; }
    setBusy(true);
    try {
      await poDocApi.adminOverride(poId, { targetStatus: target, reason });
      toast.success(`Overridden to ${target}`);
      onDone?.(); onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Override failed: ${err?.response?.data?.error || err?.message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded p-6 max-w-md w-full space-y-4">
        <h3 className="text-lg font-semibold">Admin override stage</h3>
        <p className="text-sm text-gray-600">Skip stages without normal sequence checks. Logged with reason.</p>
        <label className="block">
          <span className="text-sm">Target stage</span>
          <select value={target} onChange={e => setTarget(e.target.value as POStage)} className="border p-1 w-full">
            {PO_STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Reason</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} className="border p-1 w-full" rows={3} />
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-yellow-600 text-white px-3 py-1 rounded">
            {busy ? 'Overriding...' : 'Override'}
          </button>
        </div>
      </div>
    </div>
  );
}

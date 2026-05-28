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

export function RejectStageDialog({ poId, currentStage, onClose, onDone }: Props) {
  const eligible = PO_STAGES.slice(0, PO_STAGES.indexOf(currentStage));
  const [toStatus, setToStatus] = useState<POStage>(eligible[eligible.length - 1] || 'Registered');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim() || reason.length < 3) { toast.error('Reason required (min 3 chars)'); return; }
    setBusy(true);
    try {
      await poDocApi.reject(poId, { toStatus, reason });
      toast.success(`Rejected to ${toStatus}`);
      onDone?.(); onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Reject failed: ${err?.response?.data?.error || err?.message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded p-6 max-w-md w-full space-y-4">
        <h3 className="text-lg font-semibold">Reject stage</h3>
        <p className="text-sm text-gray-600">Move PO backward from <b>{currentStage}</b> to an earlier stage.</p>
        <label className="block">
          <span className="text-sm">Target stage</span>
          <select value={toStatus} onChange={e => setToStatus(e.target.value as POStage)} className="border p-1 w-full">
            {eligible.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Reason</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} className="border p-1 w-full" rows={3} />
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-red-600 text-white px-3 py-1 rounded">
            {busy ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

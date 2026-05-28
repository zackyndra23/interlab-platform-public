'use client';
import { useEffect, useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import type { PoStageHistoryRow } from '@/lib/po-document-types';

interface Props { poId: string; refreshKey?: number; }

export function StageTimeline({ poId, refreshKey = 0 }: Props) {
  const [items, setItems] = useState<PoStageHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    poDocApi.history(poId).then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, [poId, refreshKey]);

  if (loading) return <div className="text-sm text-gray-500">Loading history...</div>;
  if (!items.length) return <div className="text-sm text-gray-500">No history yet.</div>;

  return (
    <ol className="border-l-2 border-gray-300 pl-4 space-y-3">
      {items.map(h => (
        <li key={h.id} className="relative">
          <span className={`absolute -left-[9px] top-1.5 w-3.5 h-3.5 rounded-full ${
            h.is_rejection ? 'bg-red-500' : h.is_admin_override ? 'bg-yellow-500' : 'bg-blue-500'
          }`} />
          <div className="text-sm font-semibold">{h.status_label}
            {h.is_rejection && <span className="ml-2 text-red-600 text-xs">(rejection #{h.reject_count_after})</span>}
            {h.is_admin_override && <span className="ml-2 text-yellow-600 text-xs">(admin override)</span>}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(h.created_at).toLocaleString()} — by {h.updated_by_role}
          </div>
          {h.note && <div className="text-sm mt-1 italic">{h.note}</div>}
        </li>
      ))}
    </ol>
  );
}

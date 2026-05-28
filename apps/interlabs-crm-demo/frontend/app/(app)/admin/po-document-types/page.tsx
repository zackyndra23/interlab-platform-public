'use client';
import { useEffect, useState } from 'react';
import { poDocApi } from '@/lib/po-document-api';
import { PO_STAGES, type PoDocumentType, type POStage } from '@/lib/po-document-types';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export default function PoDocumentTypesPage() {
  const [items, setItems] = useState<PoDocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<PoDocumentType> | null>(null);

  async function refresh() {
    setLoading(true);
    try { setItems(await poDocApi.listTypes()); }
    catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!editing?.doc_key || !editing?.doc_name) { toast.error('key + name required'); return; }
    try {
      if (editing.id) await poDocApi.updateType(editing.id, editing);
      else await poDocApi.createType(editing);
      toast.success('Saved');
      setEditing(null);
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Save failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this doc type? Files referring to it will keep their reference but auto-trigger will stop firing.')) return;
    try { await poDocApi.deleteType(id); refresh(); }
    catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Delete failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">PO Document Types</h1>
        <button onClick={() => setEditing({ doc_key: '', doc_name: '', triggers_stage: null, required_for_stage: null, uploader_role_keys: [], is_active: true })}
          className="bg-blue-600 text-white px-3 py-1 rounded">+ New</button>
      </div>
      {loading ? <div>Loading...</div> : (
        <table className="w-full border-collapse text-sm">
          <thead><tr>
            <th className="border p-2 text-left">Key</th>
            <th className="border p-2 text-left">Name</th>
            <th className="border p-2 text-left">Triggers</th>
            <th className="border p-2 text-left">Uploaders</th>
            <th className="border p-2 text-left">Active</th>
            <th className="border p-2"></th>
          </tr></thead>
          <tbody>
            {items.map(t => (
              <tr key={t.id}>
                <td className="border p-2 font-mono text-xs">{t.doc_key}</td>
                <td className="border p-2">{t.doc_name}</td>
                <td className="border p-2">{t.triggers_stage || '—'}</td>
                <td className="border p-2 text-xs">{(t.uploader_role_keys || []).map(r => ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r).join(', ') || '—'}</td>
                <td className="border p-2">{t.is_active ? '✓' : '✗'}</td>
                <td className="border p-2 space-x-2">
                  <button onClick={() => setEditing(t)} className="text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => remove(t.id)} className="text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="mt-6 border p-4 rounded space-y-2 bg-gray-50">
          <h2 className="font-semibold">{editing.id ? 'Edit' : 'New'} doc type</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm">Doc key</span>
              <Input value={editing.doc_key || ''} onChange={e => setEditing({...editing, doc_key: e.target.value})} />
            </label>
            <label className="block">
              <span className="text-sm">Doc name</span>
              <Input value={editing.doc_name || ''} onChange={e => setEditing({...editing, doc_name: e.target.value})} />
            </label>
            <label className="block">
              <span className="text-sm">Triggers stage</span>
              <Select value={editing.triggers_stage || ''} onChange={e => setEditing({...editing, triggers_stage: (e.target.value || null) as POStage | null})}>
                <option value="">— none —</option>
                {PO_STAGES.map(s => <option key={s}>{s}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="text-sm">Required for stage</span>
              <Select value={editing.required_for_stage || ''} onChange={e => setEditing({...editing, required_for_stage: (e.target.value || null) as POStage | null})}>
                <option value="">— none —</option>
                {PO_STAGES.map(s => <option key={s}>{s}</option>)}
              </Select>
            </label>
            <label className="block col-span-2">
              <span className="text-sm">Uploader roles</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLE_KEYS.map(r => (
                  <label key={r} className="text-sm">
                    <input type="checkbox"
                      checked={(editing.uploader_role_keys || []).includes(r)}
                      onChange={e => {
                        const cur = editing.uploader_role_keys || [];
                        const next = e.target.checked ? [...cur, r] : cur.filter(x => x !== r);
                        setEditing({...editing, uploader_role_keys: next});
                      }} />
                    {' '}{ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </label>
            <label className="block">
              <input type="checkbox" checked={editing.is_active ?? true} onChange={e => setEditing({...editing, is_active: e.target.checked})} />
              {' '}Active
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="bg-blue-600 text-white px-3 py-1 rounded">Save</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import type { RoleLevel } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export default function LevelsPage() {
  const [activeRole, setActiveRole] = useState<typeof ROLE_KEYS[number]>('sales');
  const [levels, setLevels] = useState<RoleLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{
    levelKey: string;
    levelName: string;
    levelRank: number;
    dataScopeDefault: 'own' | 'team' | 'role' | 'global';
  }>({ levelKey: '', levelName: '', levelRank: 1, dataScopeDefault: 'own' });

  async function refresh() {
    setLoading(true);
    try {
      const items = await adminRbacApi.listLevels(activeRole);
      setLevels(items);
    } catch (e: any) {
      toast.error(`Load failed: ${e?.response?.data?.error || e?.message}`);
      setLevels([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [activeRole]);

  async function handleCreate() {
    if (!form.levelKey || !form.levelName || form.levelRank < 1) {
      toast.error('Fill key, name, and rank');
      return;
    }
    try {
      await adminRbacApi.createLevel(activeRole, form);
      toast.success('Level created');
      setCreating(false);
      setForm({ levelKey: '', levelName: '', levelRank: 1, dataScopeDefault: 'own' });
      refresh();
    } catch (e: any) {
      toast.error(`Create failed: ${e?.response?.data?.error || e?.message}`);
    }
  }

  async function handleDelete(id: string, levelName: string) {
    if (!confirm(`Delete level "${levelName}"? Will fail if any users are assigned.`)) return;
    try {
      await adminRbacApi.deleteLevel(id);
      toast.success('Deleted');
      refresh();
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.response?.data?.error || e?.message}`);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">Role Levels</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {ROLE_KEYS.map(r => (
          <button key={r} onClick={() => setActiveRole(r)}
            className={`px-3 py-1 rounded ${activeRole===r ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <table className="w-full border-collapse mb-6">
          <thead>
            <tr>
              <th className="border p-2 text-left">Rank</th>
              <th className="border p-2 text-left">Key</th>
              <th className="border p-2 text-left">Name</th>
              <th className="border p-2 text-left">Default Scope</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {levels.length === 0 ? (
              <tr><td colSpan={5} className="border p-4 text-center text-gray-500">No levels for this role yet</td></tr>
            ) : (
              levels.map(l => (
                <tr key={l.id}>
                  <td className="border p-2">{l.level_rank}</td>
                  <td className="border p-2 font-mono text-xs">{l.level_key}</td>
                  <td className="border p-2">{l.level_name}</td>
                  <td className="border p-2">{l.data_scope_default}</td>
                  <td className="border p-2">
                    <button onClick={() => handleDelete(l.id, l.level_name)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {creating ? (
        <div className="border p-4 rounded space-y-2">
          <div className="flex gap-2 flex-wrap items-end">
            <label className="text-sm">
              Key
              <Input className="ml-2 font-mono text-xs" placeholder="sales_lead"
                value={form.levelKey}
                onChange={e => setForm({...form, levelKey: e.target.value})} />
            </label>
            <label className="text-sm">
              Name
              <Input className="ml-2" placeholder="Sales Lead"
                value={form.levelName}
                onChange={e => setForm({...form, levelName: e.target.value})} />
            </label>
            <label className="text-sm">
              Rank
              <Input className="ml-2 w-16" type="number" min={1}
                value={form.levelRank}
                onChange={e => setForm({...form, levelRank: Number(e.target.value)})} />
            </label>
            <label className="text-sm">
              Scope
              <Select className="ml-2"
                value={form.dataScopeDefault}
                onChange={e => setForm({...form, dataScopeDefault: e.target.value as 'own' | 'team' | 'role' | 'global'})}>
                <option value="own">own</option>
                <option value="team">team</option>
                <option value="role">role</option>
                <option value="global">global</option>
              </Select>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-blue-600 text-white px-3 py-1 rounded">Save</button>
            <button onClick={() => setCreating(false)} className="px-3 py-1 rounded">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="bg-blue-600 text-white px-3 py-1 rounded">+ Add level</button>
      )}
    </div>
  );
}

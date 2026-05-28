'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import type { UserOverride, CrossDeptGrant, FeatureDef, CapabilityDef } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export default function UserOverridesPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [caps, setCaps] = useState<CapabilityDef[]>([]);
  const [overrides, setOverrides] = useState<UserOverride[]>([]);
  const [crossDept, setCrossDept] = useState<CrossDeptGrant[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<{
    featureId: string;
    capabilityId: string;
    type: 'grant' | 'deny';
    reason: string;
    expiresAt: string;
  }>({ featureId: '', capabilityId: '', type: 'grant', reason: '', expiresAt: '' });

  const [cdForm, setCdForm] = useState<{
    targetRoleKey: string;
    featureId: string;
    capabilityId: string;
    notes: string;
  }>({ targetRoleKey: 'sales', featureId: '', capabilityId: '', notes: '' });

  async function refresh() {
    if (!id) return;
    try {
      const o = await adminRbacApi.listOverrides(id);
      setOverrides(o.capabilities);
      setCrossDept(o.crossDept);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      adminRbacApi.listFeatures(),
      adminRbacApi.listCapabilities(),
      refresh(),
    ]).then(([f, c]) => {
      setFeatures(f); setCaps(c);
    }).catch((e: unknown) => {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Init failed: ${err?.response?.data?.error || err?.message}`);
    }).finally(() => setLoading(false));
  /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function submitOverride() {
    if (!form.featureId || !form.capabilityId) {
      toast.error('Pick feature and capability');
      return;
    }
    try {
      const body = {
        featureId: form.featureId,
        capabilityId: form.capabilityId,
        reason: form.reason || null,
        expiresAt: form.expiresAt || null,
      };
      if (form.type === 'grant') await adminRbacApi.grant(id, body);
      else await adminRbacApi.deny(id, body);
      toast.success(`${form.type} applied`);
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Apply failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  async function revokeOverride(o: UserOverride) {
    const f = features.find(x => x.feature_key === o.feature_key);
    const c = caps.find(x => x.capability_key === o.capability_key);
    if (!f || !c) {
      toast.error('Feature/capability not found in catalog');
      return;
    }
    try {
      await adminRbacApi.revoke(id, o.override_type, f.id, c.id);
      toast.success('Revoked');
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Revoke failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  async function submitCrossDept() {
    if (!cdForm.featureId || !cdForm.capabilityId || !cdForm.targetRoleKey) {
      toast.error('Pick target role, feature, and capability');
      return;
    }
    try {
      await adminRbacApi.grantCrossDept(id, {
        targetRoleKey: cdForm.targetRoleKey,
        featureId: cdForm.featureId,
        capabilityId: cdForm.capabilityId,
        notes: cdForm.notes || null,
      });
      toast.success('Cross-dept grant added');
      setCdForm({ targetRoleKey: 'sales', featureId: '', capabilityId: '', notes: '' });
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Grant failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  async function revokeCd(g: CrossDeptGrant) {
    try {
      await adminRbacApi.revokeCrossDept(g.id);
      toast.success('Revoked');
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Revoke failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  if (!id) return <div className="p-6">Missing user id in URL.</div>;
  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">User Overrides</h1>
      <div className="text-sm text-gray-500 font-mono mb-6">{id}</div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Capability overrides</h2>
        <table className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr>
              <th className="border p-2 text-left">Type</th>
              <th className="border p-2 text-left">Feature</th>
              <th className="border p-2 text-left">Capability</th>
              <th className="border p-2 text-left">Expires</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {overrides.length === 0 ? (
              <tr><td colSpan={5} className="border p-3 text-center text-gray-500">No active overrides</td></tr>
            ) : (
              overrides.map(o => (
                <tr key={o.id}>
                  <td className={`border p-2 font-medium ${o.override_type === 'deny' ? 'text-red-600' : 'text-green-600'}`}>{o.override_type}</td>
                  <td className="border p-2">{o.feature_key}</td>
                  <td className="border p-2 font-mono text-xs">{o.capability_key}</td>
                  <td className="border p-2 text-xs">{o.expires_at ? new Date(o.expires_at).toLocaleString() : '—'}</td>
                  <td className="border p-2">
                    <button onClick={() => revokeOverride(o)} className="text-red-600 hover:underline">Revoke</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex gap-2 flex-wrap items-end">
          <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'grant' | 'deny' })}>
            <option value="grant">grant</option>
            <option value="deny">deny</option>
          </Select>
          <Select value={form.featureId} onChange={e => setForm({ ...form, featureId: e.target.value })}>
            <option value="">— feature —</option>
            {features.map(f => <option key={f.id} value={f.id}>{f.feature_name}</option>)}
          </Select>
          <Select value={form.capabilityId} onChange={e => setForm({ ...form, capabilityId: e.target.value })}>
            <option value="">— capability —</option>
            {caps.map(c => <option key={c.id} value={c.id}>{c.capability_key}</option>)}
          </Select>
          <Input placeholder="reason (optional)"
            value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          <Input type="datetime-local" placeholder="expires (optional)"
            value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} />
          <button onClick={submitOverride} className="bg-blue-600 text-white px-3 py-1 rounded">Apply</button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Cross-department grants</h2>
        <table className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr>
              <th className="border p-2 text-left">Target role</th>
              <th className="border p-2 text-left">Feature</th>
              <th className="border p-2 text-left">Capability</th>
              <th className="border p-2 text-left">Notes</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {crossDept.length === 0 ? (
              <tr><td colSpan={5} className="border p-3 text-center text-gray-500">No active cross-dept grants</td></tr>
            ) : (
              crossDept.map(g => (
                <tr key={g.id}>
                  <td className="border p-2">{ROLE_LABELS[g.target_role_key as keyof typeof ROLE_LABELS] || g.target_role_key}</td>
                  <td className="border p-2">{g.feature_key}</td>
                  <td className="border p-2 font-mono text-xs">{g.capability_key}</td>
                  <td className="border p-2 text-xs">{g.notes || '—'}</td>
                  <td className="border p-2">
                    <button onClick={() => revokeCd(g)} className="text-red-600 hover:underline">Revoke</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex gap-2 flex-wrap items-end">
          <Select value={cdForm.targetRoleKey} onChange={e => setCdForm({ ...cdForm, targetRoleKey: e.target.value })}>
            {ROLE_KEYS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          <Select value={cdForm.featureId} onChange={e => setCdForm({ ...cdForm, featureId: e.target.value })}>
            <option value="">— feature —</option>
            {features.map(f => <option key={f.id} value={f.id}>{f.feature_name}</option>)}
          </Select>
          <Select value={cdForm.capabilityId} onChange={e => setCdForm({ ...cdForm, capabilityId: e.target.value })}>
            <option value="">— capability —</option>
            {caps.map(c => <option key={c.id} value={c.id}>{c.capability_key}</option>)}
          </Select>
          <Input placeholder="notes" value={cdForm.notes} onChange={e => setCdForm({ ...cdForm, notes: e.target.value })} />
          <button onClick={submitCrossDept} className="bg-blue-600 text-white px-3 py-1 rounded">Grant</button>
        </div>
      </section>
    </div>
  );
}

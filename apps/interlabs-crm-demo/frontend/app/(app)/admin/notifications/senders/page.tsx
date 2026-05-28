'use client';
import { useEffect, useState } from 'react';
import { notificationApi } from '@/lib/notification-api';
import type { NotificationSender, NotificationProvider } from '@/lib/notification-types';
import { toast } from 'sonner';

const PROVIDERS: NotificationProvider[] = ['smtp', 'gmail', 'ses', 'postmark', 'resend'];

const emptyForm = (): Partial<NotificationSender> => ({
  sender_key: '',
  display_name: '',
  from_email: '',
  reply_to_email: null,
  provider: 'smtp',
  provider_config_key: 'smtp.default',
  is_active: true,
});

export default function NotificationSendersPage() {
  const [items, setItems] = useState<NotificationSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<NotificationSender> | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await notificationApi.listSenders());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!editing?.sender_key || !editing?.display_name || !editing?.from_email || !editing?.provider || !editing?.provider_config_key) {
      toast.error('sender_key, display_name, from_email, provider, and provider_config_key are required');
      return;
    }
    try {
      if (editing.id) {
        await notificationApi.updateSender(editing.id, editing);
      } else {
        await notificationApi.createSender(editing);
      }
      toast.success('Saved');
      setEditing(null);
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Save failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  async function remove(id: string, key: string) {
    if (!confirm(`Delete sender "${key}"? This will fail if any templates are currently using it.`)) return;
    try {
      await notificationApi.deleteSender(id);
      toast.success('Deleted');
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Delete failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Notification Senders</h1>
        <button
          onClick={() => setEditing(emptyForm())}
          className="bg-blue-600 text-white px-3 py-1 rounded"
        >
          + New Sender
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border p-2 text-left">Key</th>
              <th className="border p-2 text-left">Display Name</th>
              <th className="border p-2 text-left">From Email</th>
              <th className="border p-2 text-left">Provider</th>
              <th className="border p-2 text-left">Config Key</th>
              <th className="border p-2 text-left">Active</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="border p-4 text-center text-gray-500">
                  No senders configured yet
                </td>
              </tr>
            ) : (
              items.map(s => (
                <tr key={s.id}>
                  <td className="border p-2 font-mono text-xs">{s.sender_key}</td>
                  <td className="border p-2">{s.display_name}</td>
                  <td className="border p-2">{s.from_email}</td>
                  <td className="border p-2">
                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-mono">
                      {s.provider}
                    </span>
                  </td>
                  <td className="border p-2 font-mono text-xs">{s.provider_config_key}</td>
                  <td className="border p-2">{s.is_active ? '✓' : '✗'}</td>
                  <td className="border p-2 space-x-2">
                    <button onClick={() => setEditing(s)} className="text-blue-600 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => remove(s.id, s.sender_key)} className="text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="mt-6 border p-4 rounded space-y-3 bg-gray-50 dark:bg-gray-800">
          <h2 className="font-semibold">{editing.id ? 'Edit' : 'New'} Sender</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Sender Key *</span>
              <input
                className="border p-1.5 w-full rounded font-mono text-sm mt-0.5"
                placeholder="noreply"
                value={editing.sender_key || ''}
                onChange={e => setEditing({ ...editing, sender_key: e.target.value })}
                disabled={!!editing.id}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Display Name *</span>
              <input
                className="border p-1.5 w-full rounded mt-0.5"
                placeholder="Interlab Notifications"
                value={editing.display_name || ''}
                onChange={e => setEditing({ ...editing, display_name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">From Email *</span>
              <input
                className="border p-1.5 w-full rounded mt-0.5"
                type="email"
                placeholder="noreply@interlab-portal.com"
                value={editing.from_email || ''}
                onChange={e => setEditing({ ...editing, from_email: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Reply-To Email</span>
              <input
                className="border p-1.5 w-full rounded mt-0.5"
                type="email"
                placeholder="(optional)"
                value={editing.reply_to_email || ''}
                onChange={e => setEditing({ ...editing, reply_to_email: e.target.value || null })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Provider *</span>
              <select
                className="border p-1.5 w-full rounded mt-0.5"
                value={editing.provider || 'smtp'}
                onChange={e => setEditing({ ...editing, provider: e.target.value as NotificationProvider })}
              >
                {PROVIDERS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Provider Config Key *</span>
              <input
                className="border p-1.5 w-full rounded mt-0.5 font-mono text-sm"
                placeholder="smtp.default"
                value={editing.provider_config_key || ''}
                onChange={e => setEditing({ ...editing, provider_config_key: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                checked={editing.is_active ?? true}
                onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
              />
              <span className="text-sm">Active</span>
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="bg-blue-600 text-white px-4 py-1.5 rounded">
              Save
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded border">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

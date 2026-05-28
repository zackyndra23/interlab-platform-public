'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { notificationApi } from '@/lib/notification-api';
import type { NotificationTemplateRow, NotificationSender, TemplateExtraRecipient } from '@/lib/notification-types';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type RoleKey = typeof ROLE_KEYS[number];

export default function TemplateEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [template, setTemplate] = useState<NotificationTemplateRow | null>(null);
  const [extras, setExtras] = useState<TemplateExtraRecipient[]>([]);
  const [senders, setSenders] = useState<NotificationSender[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [senderId, setSenderId] = useState<string | null>(null);
  const [recipientRoles, setRecipientRoles] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(false);
  const [sendDashboard, setSendDashboard] = useState(false);
  const [status, setStatus] = useState<'enabled' | 'disabled'>('enabled');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Extra recipients state
  const [newUserId, setNewUserId] = useState('');
  const [savingExtras, setSavingExtras] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [data, senderList] = await Promise.all([
        notificationApi.getTemplate(id),
        notificationApi.listSenders(),
      ]);
      setTemplate(data.template);
      setExtras(data.extra_recipients);
      setSenders(senderList);

      // Populate edit state
      setSenderId(data.template.sender_id);
      setRecipientRoles(data.template.recipient_roles_json || []);
      setSendEmail(data.template.send_email_enabled);
      setSendDashboard(data.template.send_dashboard_notification_enabled);
      setStatus(data.template.status);
      setSubject(data.template.subject || '');
      setBody(data.template.body || '');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id]);

  async function save() {
    try {
      await notificationApi.patchTemplate(id, {
        sender_id: senderId,
        recipient_roles_json: recipientRoles,
        send_email_enabled: sendEmail,
        send_dashboard_notification_enabled: sendDashboard,
        status,
        subject: subject || null,
        body: body || null,
      });
      toast.success('Template saved');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Save failed: ${err?.response?.data?.error || err?.message}`);
    }
  }

  function toggleRole(role: string) {
    setRecipientRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function addExtra() {
    const uid = newUserId.trim();
    if (!uid) return;
    if (!UUID_RE.test(uid)) {
      toast.error('Not a valid UUID');
      return;
    }
    if (extras.some(e => e.user_id === uid)) {
      toast.error('User already in extras list');
      return;
    }
    setSavingExtras(true);
    try {
      const updatedIds = [...extras.map(e => e.user_id), uid];
      await notificationApi.setExtraRecipients(id, updatedIds);
      setNewUserId('');
      toast.success('Extra recipient added');
      await refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Add failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setSavingExtras(false);
    }
  }

  async function removeExtra(userId: string) {
    setSavingExtras(true);
    try {
      const updatedIds = extras.filter(e => e.user_id !== userId).map(e => e.user_id);
      await notificationApi.setExtraRecipients(id, updatedIds);
      toast.success('Removed');
      await refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Remove failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setSavingExtras(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading...</div>;
  }
  if (!template) {
    return <div className="p-6 text-red-600">Template not found.</div>;
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">Edit Template</h1>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm space-y-1">
        <div>
          <span className="font-medium">Key: </span>
          <span className="font-mono">{template.template_key}</span>
        </div>
        <div>
          <span className="font-medium">Name: </span>
          {template.template_name}
        </div>
        <div>
          <span className="font-medium">Group: </span>
          {template.feature_group}
        </div>
        <div>
          <span className="font-medium">Trigger: </span>
          <span className="font-mono">{template.trigger_event}</span>
        </div>
      </div>

      {/* Sender */}
      <section>
        <label className="block mb-1 font-medium text-sm">Sender</label>
        <Select
          className="max-w-sm"
          value={senderId || ''}
          onChange={e => setSenderId(e.target.value || null)}
        >
          <option value="">— use default —</option>
          {senders.map(s => (
            <option key={s.id} value={s.id}>
              {s.display_name} ({s.from_email}) [{s.provider}]
            </option>
          ))}
        </Select>
      </section>

      {/* Recipient Roles */}
      <section>
        <label className="block mb-1 font-medium text-sm">Recipient Roles</label>
        <div className="flex flex-wrap gap-3">
          {ROLE_KEYS.map(r => (
            <label key={r} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={recipientRoles.includes(r)}
                onChange={() => toggleRole(r)}
              />
              {ROLE_LABELS[r as RoleKey]}
            </label>
          ))}
          {/* superadmin + ceo */}
          {(['superadmin', 'ceo'] as const).map(r => (
            <label key={r} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={recipientRoles.includes(r)}
                onChange={() => toggleRole(r)}
              />
              {ROLE_LABELS[r as RoleKey]}
            </label>
          ))}
        </div>
      </section>

      {/* Toggles */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={e => setSendEmail(e.target.checked)}
          />
          <span className="text-sm font-medium">Send Email</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sendDashboard}
            onChange={e => setSendDashboard(e.target.checked)}
          />
          <span className="text-sm font-medium">Send Dashboard Notification</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={status === 'enabled'}
            onChange={e => setStatus(e.target.checked ? 'enabled' : 'disabled')}
          />
          <span className="text-sm font-medium">
            Template Enabled
            <span className={`ml-2 text-xs ${status === 'enabled' ? 'text-green-600' : 'text-red-500'}`}>
              ({status})
            </span>
          </span>
        </label>
      </section>

      {/* Subject */}
      <section>
        <label className="block mb-1 font-medium text-sm">Subject</label>
        <Input
          placeholder="Email subject line..."
          value={subject}
          onChange={e => setSubject(e.target.value)}
        />
      </section>

      {/* Body */}
      <section>
        <label className="block mb-1 font-medium text-sm">Body (HTML)</label>
        <textarea
          className="bg-red-500/10 dark:bg-red-500/20 text-red-900 dark:text-red-100 border border-red-500/30 rounded focus:bg-red-500/20 dark:focus:bg-red-500/30 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 transition-colors p-2 w-full rounded font-mono text-sm resize-y"
          rows={8}
          placeholder="<p>Email body HTML...</p>"
          value={body}
          onChange={e => setBody(e.target.value)}
        />
      </section>

      <button onClick={save} className="bg-blue-600 text-white px-5 py-2 rounded">
        Save Template
      </button>

      {/* Extra Recipients */}
      <section className="border-t pt-5">
        <h2 className="font-semibold mb-2">Extra Recipients</h2>
        <p className="text-xs text-gray-500 mb-3">
          These users receive this notification beyond the role-based recipients above.
        </p>
        {extras.length === 0 ? (
          <div className="text-sm text-gray-400 mb-3">No extra recipients.</div>
        ) : (
          <table className="w-full border-collapse text-sm mb-3">
            <thead>
              <tr>
                <th className="border p-2 text-left">Display Name</th>
                <th className="border p-2 text-left">Email</th>
                <th className="border p-2 text-left">User ID</th>
                <th className="border p-2"></th>
              </tr>
            </thead>
            <tbody>
              {extras.map(ex => (
                <tr key={ex.user_id}>
                  <td className="border p-2">{ex.display_name}</td>
                  <td className="border p-2">{ex.email}</td>
                  <td className="border p-2 font-mono text-xs text-gray-500">{ex.user_id}</td>
                  <td className="border p-2">
                    <button
                      onClick={() => removeExtra(ex.user_id)}
                      disabled={savingExtras}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex gap-2 items-end">
          <label className="block flex-1">
            <span className="text-sm font-medium">Add by User ID</span>
            <Input
              className="font-mono mt-0.5"
              placeholder="paste UUID..."
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addExtra(); }}
            />
          </label>
          <button
            onClick={addExtra}
            disabled={savingExtras || !newUserId.trim()}
            className="bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Tip: copy a user&apos;s UUID from the Users admin page.
        </p>
      </section>
    </div>
  );
}

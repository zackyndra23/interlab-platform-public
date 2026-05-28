'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notificationApi } from '@/lib/notification-api';
import type { NotificationTemplateRow, NotificationSender } from '@/lib/notification-types';
import { toast } from 'sonner';

function groupByFeature(items: NotificationTemplateRow[]) {
  const groups: Record<string, NotificationTemplateRow[]> = {};
  for (const item of items) {
    const key = item.feature_group || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export default function NotificationTemplatesPage() {
  const [items, setItems] = useState<NotificationTemplateRow[]>([]);
  const [senders, setSenders] = useState<NotificationSender[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [tmplList, senderList] = await Promise.all([
        notificationApi.listTemplates(),
        notificationApi.listSenders(),
      ]);
      setItems(tmplList);
      setSenders(senderList);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const senderMap = Object.fromEntries(senders.map(s => [s.id, s]));
  const groups = groupByFeature(items);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Notification Templates</h1>
        <span className="text-sm text-gray-500">{items.length} template{items.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 p-8 text-center border rounded">No notification templates found.</div>
      ) : (
        Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([group, rows]) => (
          <div key={group} className="mb-8">
            <h2 className="text-lg font-medium mb-2 capitalize border-b pb-1">
              {group.replace(/_/g, ' ')}
            </h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border p-2 text-left">Template Name</th>
                  <th className="border p-2 text-left">Trigger Event</th>
                  <th className="border p-2 text-left">Status</th>
                  <th className="border p-2 text-left">Email</th>
                  <th className="border p-2 text-left">Dashboard</th>
                  <th className="border p-2 text-left">Sender</th>
                  <th className="border p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const sender = t.sender_id ? senderMap[t.sender_id] : null;
                  return (
                    <tr key={t.id}>
                      <td className="border p-2 font-medium">{t.template_name}</td>
                      <td className="border p-2 font-mono text-xs text-gray-600">{t.trigger_event}</td>
                      <td className="border p-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          t.status === 'enabled'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="border p-2 text-center">{t.send_email_enabled ? '✓' : '—'}</td>
                      <td className="border p-2 text-center">{t.send_dashboard_notification_enabled ? '✓' : '—'}</td>
                      <td className="border p-2 text-xs">
                        {sender ? (
                          <span title={`${sender.provider} · ${sender.from_email}`}>
                            {sender.display_name}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="border p-2">
                        <Link
                          href={`/admin/notifications/templates/${t.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

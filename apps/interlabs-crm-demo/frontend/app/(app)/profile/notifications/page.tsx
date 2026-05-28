'use client';
import { useEffect, useState } from 'react';
import { notificationApi } from '@/lib/notification-api';
import type { MyNotificationTemplateRow } from '@/lib/notification-types';
import { toast } from 'sonner';

function groupByFeature(items: MyNotificationTemplateRow[]) {
  const groups: Record<string, MyNotificationTemplateRow[]> = {};
  for (const item of items) {
    const key = item.feature_group || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export default function ProfileNotificationsPage() {
  const [items, setItems] = useState<MyNotificationTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await notificationApi.listMyTemplates());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function toggleMute(item: MyNotificationTemplateRow) {
    setToggling(item.id);
    try {
      if (item.muted) {
        await notificationApi.unmute(item.id);
        toast.success(`Unmuted: ${item.template_name}`);
      } else {
        await notificationApi.mute(item.id);
        toast.success(`Muted: ${item.template_name}`);
      }
      // Optimistic update
      setItems(prev => prev.map(t => t.id === item.id ? { ...t, muted: !t.muted } : t));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Toggle failed: ${err?.response?.data?.error || err?.message}`);
    } finally {
      setToggling(null);
    }
  }

  const groups = groupByFeature(items);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Notification Preferences</h1>
      <p className="text-sm text-gray-500 mb-6">
        Mute specific notifications you don&apos;t want to receive. Muted notifications will not appear in your
        dashboard or inbox.
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 p-8 text-center border rounded">
          No notification templates available.
        </div>
      ) : (
        Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([group, rows]) => (
          <div key={group} className="mb-6">
            <h2 className="text-base font-medium mb-2 capitalize border-b pb-1">
              {group.replace(/_/g, ' ')}
            </h2>
            <div className="space-y-1">
              {rows.map(t => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between p-2.5 rounded border ${
                    t.muted ? 'bg-gray-50 dark:bg-gray-800 opacity-75' : 'bg-white dark:bg-gray-900'
                  }`}
                >
                  <div>
                    <div className={`text-sm font-medium ${t.muted ? 'text-gray-400' : ''}`}>
                      {t.template_name}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">{t.template_key}</div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs text-gray-500">
                      {t.muted ? 'Muted' : 'Active'}
                    </span>
                    <button
                      onClick={() => toggleMute(t)}
                      disabled={toggling === t.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                        t.muted
                          ? 'bg-gray-300 dark:bg-gray-600'
                          : 'bg-blue-600'
                      }`}
                      role="switch"
                      aria-checked={!t.muted}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          t.muted ? 'translate-x-0.5' : 'translate-x-5'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

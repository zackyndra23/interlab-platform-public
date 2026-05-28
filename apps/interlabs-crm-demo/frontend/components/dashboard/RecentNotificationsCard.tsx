'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

import { notificationsApi } from '@/lib/global-api';
import { useNotificationStore } from '@/stores/notification.store';
import { relativeTime } from '@/lib/utils';
import type { NotificationRow } from '@/lib/global-types';

/**
 * F7 shared dashboard widget — Recent Notifications card (latest 3).
 *
 * On mount we pull the 3 most recent notifications regardless of read
 * state so the card reflects "what just happened" rather than the bell
 * dropdown's unread-only view. Real-time pushes route through the
 * existing notification store via `useNotifications`/NotificationDropdown,
 * so this card opportunistically prepends store updates when the store's
 * `latestUnread` changes — keeps the dashboard fresh without each widget
 * re-subscribing to the WebSocket.
 */
export function RecentNotificationsCard() {
    const [rows, setRows] = useState<NotificationRow[]>([]);
    const [loading, setLoading] = useState(true);
    const storeUnread = useNotificationStore((s) => s.latestUnread);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await notificationsApi.listAll({ page: 1, limit: 3 });
                if (cancelled) return;
                setRows(res.rows);
            } catch {
                if (!cancelled) setRows([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // When the store reports a new unread (push from notification:new),
    // prepend it so the card surfaces realtime activity. We dedupe by id
    // and trim to 3 rows.
    useEffect(() => {
        if (storeUnread.length === 0) return;
        setRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const additions = storeUnread
                .filter((n) => !seen.has(n.id))
                .map<NotificationRow>((n) => ({
                    id: n.id,
                    title: n.title,
                    message: n.message,
                    related_module: n.related_module,
                    related_entity_type: n.related_entity_type,
                    related_entity_id: n.related_entity_id,
                    sender_user_id: null,
                    recipient_user_id: null,
                    recipient_role: null,
                    is_read: n.is_read,
                    created_at: n.created_at,
                }));
            if (additions.length === 0) return prev;
            return [...additions, ...prev].slice(0, 3);
        });
    }, [storeUnread]);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Bell size={14} /> Recent Notifications
                </h3>
                <Link href="/notifications" className="text-xs text-primary hover:underline">
                    View all
                </Link>
            </div>
            {loading ? (
                <div className="space-y-2" aria-hidden>
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="h-10 animate-pulse rounded-md bg-muted"
                        />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {rows.map((n) => (
                        <li key={n.id} className="flex items-start gap-2 px-3 py-2">
                            <span
                                className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                                    n.is_read ? 'bg-muted' : 'bg-primary'
                                }`}
                                aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                                <p className={`truncate ${n.is_read ? 'font-normal' : 'font-medium'}`}>
                                    {n.title}
                                </p>
                                {n.message && (
                                    <p className="line-clamp-1 text-xs text-muted-foreground">
                                        {n.message}
                                    </p>
                                )}
                            </div>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                                {relativeTime(n.created_at)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

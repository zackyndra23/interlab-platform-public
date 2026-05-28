'use client';

import { useEffect } from 'react';

import { apiGet, apiPut } from '@/lib/api';
import { websocket } from '@/lib/websocket';
import {
    useNotificationStore,
    type NotificationItem,
} from '@/stores/notification.store';

/**
 * Binds the notification store to the backend + WebSocket events:
 *
 *   1. Initial load: GET /api/notifications?limit=5&unread=true → seeds
 *      the dropdown list and the badge count.
 *   2. Realtime: subscribes to `notification:new` and `notification:count`
 *      push events from the WebSocket.
 *   3. markRead / markAllRead helpers round-trip the server and update
 *      the store optimistically.
 *
 * Mount once (e.g. inside AppShell) so every page sees the same live
 * badge state.
 */
export function useNotifications(): {
    unreadCount: number;
    latestUnread: NotificationItem[];
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
} {
    const {
        unreadCount, latestUnread,
        setUnreadCount, setLatestUnread, addNotification,
        markReadLocal, markAllReadLocal,
    } = useNotificationStore();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rows = await apiGet<NotificationItem[]>(
                    '/api/notifications', { limit: 5, unread: true },
                );
                if (cancelled) return;
                setLatestUnread(rows);
                setUnreadCount(rows.length);
            } catch {
                // Silent fail — dropdown stays empty until next push.
            }
        })();
        return () => { cancelled = true; };
    }, [setLatestUnread, setUnreadCount]);

    useEffect(() => {
        const offNew = websocket.on<NotificationItem & { notification_id?: string }>(
            'notification:new',
            (payload) => {
                // Backend emits `notification_id` in the push envelope; normalise
                // into the store's `id` field.
                const item: NotificationItem = {
                    id: (payload as { notification_id?: string }).notification_id
                        || (payload as { id?: string }).id
                        || '',
                    title: payload.title,
                    message: payload.message,
                    related_module: payload.related_module,
                    related_entity_type: payload.related_entity_type,
                    related_entity_id: payload.related_entity_id,
                    is_read: false,
                    created_at: payload.created_at,
                };
                if (item.id) addNotification(item);
            },
        );
        const offCount = websocket.on<{ unread_count: number }>(
            'notification:count',
            (payload) => setUnreadCount(payload.unread_count),
        );
        return () => { offNew(); offCount(); };
    }, [addNotification, setUnreadCount]);

    async function markRead(id: string): Promise<void> {
        markReadLocal(id);
        try { await apiPut(`/api/notifications/${id}/read`); }
        catch { /* badge will self-correct on next notification:count */ }
    }

    async function markAllRead(): Promise<void> {
        markAllReadLocal();
        try { await apiPut('/api/notifications/read-all'); }
        catch { /* same */ }
    }

    return { unreadCount, latestUnread, markRead, markAllRead };
}

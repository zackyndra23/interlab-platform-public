import { create } from 'zustand';

/**
 * Notification store — bell badge state + most-recent-unread cache for the
 * dropdown. Full history pagination lives on /notifications and is fetched
 * per visit; this store holds just enough for realtime UI updates.
 */

export type NotificationItem = {
    id: string;
    title: string;
    message: string | null;
    related_module: string | null;
    related_entity_type: string | null;
    related_entity_id: string | null;
    is_read: boolean;
    created_at: string;
};

type NotificationState = {
    unreadCount: number;
    latestUnread: NotificationItem[];

    setUnreadCount: (n: number) => void;
    setLatestUnread: (items: NotificationItem[]) => void;
    /** Prepend a freshly received notification from the WebSocket push. */
    addNotification: (item: NotificationItem) => void;
    /** Mark a single item read locally (optimistic); caller is responsible
     *  for the matching REST call. */
    markReadLocal: (id: string) => void;
    /** Mark everything read locally. */
    markAllReadLocal: () => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
    unreadCount: 0,
    latestUnread: [],

    setUnreadCount: (unreadCount) => set({ unreadCount: Math.max(0, unreadCount) }),

    setLatestUnread: (latestUnread) => set({ latestUnread }),

    addNotification: (item) => set((s) => ({
        latestUnread: [item, ...s.latestUnread].slice(0, 5),
        unreadCount: s.unreadCount + 1,
    })),

    markReadLocal: (id) => set((s) => ({
        latestUnread: s.latestUnread.filter((n) => n.id !== id),
        unreadCount: Math.max(0, s.unreadCount - 1),
    })),

    markAllReadLocal: () => set({ latestUnread: [], unreadCount: 0 }),
}));

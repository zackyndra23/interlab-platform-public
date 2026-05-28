'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import { cn, relativeTime } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';

/**
 * Bell icon + unread badge + dropdown of latest 5 unread notifications.
 * Uses a local open/close flag + click-outside guard; no extra UI library.
 */
export function NotificationDropdown() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const { unreadCount, latestUnread, markRead, markAllRead } = useNotifications();

    useEffect(() => {
        if (!open) return;
        function onClick(e: MouseEvent) {
            if (!ref.current) return;
            if (!ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label="Notifications"
                className="relative rounded-md p-2 hover:bg-accent"
            >
                <Bell size={18} />
                {unreadCount > 0 && (
                    <span className={cn(
                        'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center',
                        'justify-center rounded-full bg-destructive px-1 text-[10px]',
                        'font-semibold text-destructive-foreground',
                    )}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className={cn(
                    'absolute right-0 top-11 z-50 w-80 rounded-md border bg-popover shadow-lg',
                    'text-popover-foreground',
                )}>
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <span className="text-sm font-semibold">Notifications</span>
                        <button
                            type="button"
                            onClick={markAllRead}
                            disabled={unreadCount === 0}
                            className="text-xs text-primary hover:underline disabled:opacity-40"
                        >
                            Mark all read
                        </button>
                    </div>
                    <ul className="max-h-80 overflow-y-auto">
                        {latestUnread.length === 0 && (
                            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                                No unread notifications
                            </li>
                        )}
                        {latestUnread.map((n) => (
                            <li key={n.id} className="border-b border-border last:border-none">
                                <button
                                    type="button"
                                    onClick={() => markRead(n.id)}
                                    className="block w-full px-3 py-2 text-left hover:bg-accent"
                                >
                                    <p className="truncate text-sm font-medium">{n.title}</p>
                                    {n.message && (
                                        <p className="truncate text-xs text-muted-foreground">{n.message}</p>
                                    )}
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                        {relativeTime(n.created_at)}
                                    </p>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="border-t border-border px-3 py-2 text-center">
                        <Link
                            href="/notifications"
                            className="text-xs text-primary hover:underline"
                            onClick={() => setOpen(false)}
                        >
                            View all notifications
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}

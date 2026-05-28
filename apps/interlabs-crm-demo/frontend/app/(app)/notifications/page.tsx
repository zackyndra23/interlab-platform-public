'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useNotificationStore } from '@/stores/notification.store';
import { notificationsApi } from '@/lib/global-api';
import { cn, relativeTime } from '@/lib/utils';
import type { NotificationRow } from '@/lib/global-types';

/**
 * /notifications — full paginated list per IMPL_frontend §F5.
 *
 * Tabs: All / Unread / Read. Each row offers a "mark as read" icon and
 * "Mark all read" sits above the list. Real-time push events prepend to
 * the visible list (when the tab allows it) and decrement the bell badge
 * via the shared notification store.
 */

type Tab = 'all' | 'unread' | 'read';

const PAGE_SIZE = 25;

/**
 * Map related_module strings to navigable detail-page paths. Anything not
 * in the map renders as a plain row without a link.
 */
function entityHref(n: NotificationRow): string | null {
    if (!n.related_module || !n.related_entity_id) return null;
    const id = n.related_entity_id;
    switch (n.related_module) {
        case 'sales.purchase_order':
        case 'po':
            return `/po-tracking?po=${encodeURIComponent(n.related_entity_id)}`;
        case 'sales.purchase_request':
            return `/sales/purchase-requests/${id}`;
        case 'sales.quotation':
            return `/sales/quotations/${id}`;
        case 'sales.forecast':
            return `/sales/forecasts/${id}`;
        case 'admin_log.awb':
            return `/admin-log/awb/${id}`;
        case 'admin_log.delivery_order':
            return `/admin-log/delivery-orders/${id}`;
        case 'finance.po_customer':
            return `/finance/po-customers/${id}`;
        case 'finance.invoice_manufacture':
            return `/finance/invoice-manufactures/${id}`;
        case 'finance.invoice_customer':
            return `/finance/invoice-customers/${id}`;
        case 'technical.job_order':
            return `/technical/job-orders/${id}`;
        case 'technical.installation':
            return `/technical/installations/${id}`;
        case 'technical.bast':
            return `/technical/bast/${id}`;
        case 'hrga.legal_documents':
            return `/hrga/legalitas/${id}`;
        case 'hrga.company_letters':
            return `/hrga/company-letters/${id}`;
        case 'tax':
            return `/tax/operational/${id}`;
        default:
            return null;
    }
}

export default function NotificationsPage() {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>('all');
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState<NotificationRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    // Keep the bell badge in sync when this page mutates read state.
    const markReadLocal = useNotificationStore((s) => s.markReadLocal);
    const markAllReadLocal = useNotificationStore((s) => s.markAllReadLocal);
    const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

    const isReadFilter = useMemo(() => {
        if (tab === 'unread') return false;
        if (tab === 'read') return true;
        return undefined;
    }, [tab]);

    const reload = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            const res = await notificationsApi.listAll({
                page, limit: PAGE_SIZE, is_read: isReadFilter,
            });
            setRows(res.rows);
            setTotal(res.meta?.total ?? res.rows.length);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
            setRows([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [page, isReadFilter]);

    useEffect(() => { reload(); }, [reload]);

    // Realtime: prepend new notifications when the visible tab includes them.
    useWebSocket<{
        notification_id?: string;
        id?: string;
        title: string;
        message: string | null;
        related_module: string | null;
        related_entity_type: string | null;
        related_entity_id: string | null;
        created_at: string;
    }>('notification:new', (push) => {
        if (page !== 1) return;
        if (tab === 'read') return;
        const id = push.notification_id || push.id;
        if (!id) return;
        const item: NotificationRow = {
            id,
            title: push.title,
            message: push.message,
            related_module: push.related_module,
            related_entity_type: push.related_entity_type,
            related_entity_id: push.related_entity_id,
            sender_user_id: null,
            recipient_user_id: null,
            recipient_role: null,
            is_read: false,
            created_at: push.created_at,
        };
        setRows((prev) => [item, ...prev].slice(0, PAGE_SIZE));
        setTotal((t) => t + 1);
    });

    async function doMarkRead(row: NotificationRow): Promise<void> {
        if (row.is_read) return;
        // Optimistic local + global badge update.
        markReadLocal(row.id);
        setRows((prev) => prev.map((r) =>
            r.id === row.id ? { ...r, is_read: true } : r,
        ));
        if (tab === 'unread') {
            // Drop it from the unread tab once read.
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            setTotal((t) => Math.max(0, t - 1));
        }
        try { await notificationsApi.markRead(row.id); }
        catch (err) {
            toast.error(err instanceof Error ? err.message : 'Mark read failed');
        }
    }

    async function doMarkAllRead(): Promise<void> {
        markAllReadLocal();
        setRows((prev) => prev.map((r) => ({ ...r, is_read: true })));
        try {
            const res = await notificationsApi.markAllRead();
            toast.success(`Marked ${res.updated ?? 'all'} as read`);
            // Refresh in case there were unread rows past this page.
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Mark all failed');
        }
    }

    function open(row: NotificationRow): void {
        const href = entityHref(row);
        // Mark as read as a side-effect of opening the entity.
        if (!row.is_read) doMarkRead(row);
        if (href) router.push(href);
    }

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const unreadVisible = rows.filter((r) => !r.is_read).length;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">Notifications</h2>
                    <p className="text-xs text-muted-foreground">
                        Your full notification history. Realtime — new alerts appear at the top.
                    </p>
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={doMarkAllRead}
                    disabled={loading || unreadVisible === 0}
                >
                    <CheckCheck size={14} />
                    Mark all read
                </Button>
            </div>

            <div className="flex items-center gap-1 border-b border-border">
                {(['all', 'unread', 'read'] as Tab[]).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => { setTab(t); setPage(1); }}
                        className={cn(
                            'px-3 py-2 text-sm capitalize',
                            tab === t
                                ? 'border-b-2 border-primary font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t}
                    </button>
                ))}
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-card">
                {loading ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
                ) : rows.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                        No notifications.
                    </p>
                ) : (
                    <ul className="divide-y divide-border">
                        {rows.map((row) => (
                            <li
                                key={row.id}
                                className={cn(
                                    'flex items-start gap-3 px-4 py-3',
                                    !row.is_read && 'bg-primary/5',
                                )}
                            >
                                <span
                                    className={cn(
                                        'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
                                        row.is_read ? 'bg-muted' : 'bg-primary',
                                    )}
                                    aria-hidden
                                />
                                <button
                                    type="button"
                                    onClick={() => open(row)}
                                    className="min-w-0 flex-1 text-left"
                                >
                                    <p className={cn(
                                        'truncate text-sm',
                                        row.is_read ? 'font-normal' : 'font-medium',
                                    )}>
                                        {row.title}
                                    </p>
                                    {row.message && (
                                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                            {row.message}
                                        </p>
                                    )}
                                    <div className="mt-1 flex items-center gap-2">
                                        {row.related_module && (
                                            <StatusBadge
                                                status={row.related_module}
                                                variant="muted"
                                            />
                                        )}
                                        <span className="text-[10px] text-muted-foreground">
                                            {relativeTime(row.created_at)}
                                        </span>
                                    </div>
                                </button>
                                {!row.is_read && (
                                    <IconButton
                                        icon={Check}
                                        tooltip="Mark as read"
                                        onClick={() => doMarkRead(row)}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Page {page} of {pageCount} · {total} notifications</span>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page <= 1 || loading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        Prev
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount || loading}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
}

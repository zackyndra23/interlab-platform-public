'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Wifi } from 'lucide-react';

import { api, type ApiEnvelope } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { isGlobalRole, ROLE_LABEL, type RoleKey } from '@/lib/rbac';
import { cn } from '@/lib/utils';

/**
 * /activity-logs — superadmin + CEO only.
 *
 * Two tabs:
 *   - "Online Now"    — live view of WebSocket-connected users (30s refresh).
 *   - "Activity Log"  — paginated, filterable audit trail.
 *
 * The backend (rbacGuard('activity_log', 'view_global')) still 403s for any
 * non-superadmin/ceo; the client redirect below is just a UX nicety.
 */

type Tab = 'online' | 'log';

type OnlineUser = {
    id: string;
    email: string;
    display_name: string;
    role: RoleKey;
    avatar_url: string | null;
    connections: number;
};

type ActivityRow = {
    id: string;
    user_id: string | null;
    user_email: string;
    user_role: RoleKey;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    detail: unknown;
    ip_address: string | null;
    created_at: string;
};

type ListMeta = {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
};

const PAGE_SIZE = 50;
const ONLINE_REFRESH_MS = 30_000;

const ACTION_OPTIONS = [
    { value: '',        label: 'All actions' },
    { value: 'login',   label: 'Login' },
    { value: 'logout',  label: 'Logout' },
    { value: 'create',  label: 'Create' },
    { value: 'edit',    label: 'Edit' },
    { value: 'delete',  label: 'Delete' },
    { value: 'export',  label: 'Export' },
    { value: 'view',    label: 'View' },
];

const ACTION_BADGE: Record<string, string> = {
    login:  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    logout: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
    create: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    edit:   'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    delete: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    export: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
    view:   'bg-gray-500/15 text-gray-600 dark:text-gray-300 border-gray-500/30',
};

const TIMESTAMP_FMT = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
});

function formatTimestamp(iso: string): string {
    try {
        // en-GB emits "21 Apr 2026, 14:32:05"
        return TIMESTAMP_FMT.format(new Date(iso));
    } catch {
        return iso;
    }
}

function initialOf(name: string): string {
    const trimmed = (name || '').trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
}

function roleLabel(role: string): string {
    return ROLE_LABEL[role as RoleKey] || role;
}

function formatDetail(detail: unknown): string {
    if (detail === null || detail === undefined) return '—';
    if (typeof detail === 'string') return detail;
    try {
        const text = JSON.stringify(detail);
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    } catch {
        return '—';
    }
}

export default function ActivityLogsPage() {
    const router = useRouter();
    const user = useAuthStore((s) => s.user);
    const status = useAuthStore((s) => s.status);

    // Gate: non-global roles never reach this page's API either way, but the
    // client-side redirect avoids flashing an "access denied" state.
    useEffect(() => {
        if (status === 'authenticated' && !isGlobalRole(user?.role)) {
            router.replace('/dashboard');
        }
    }, [status, user?.role, router]);

    const [tab, setTab] = useState<Tab>('online');

    if (!user || !isGlobalRole(user.role)) {
        return null;
    }

    return (
        <div className="space-y-4">
            <header>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold">
                            <Activity size={20} /> Activity Logs
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Monitor all user actions and live sessions across the platform.
                        </p>
                    </div>
                    <span className="rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                        Superadmin / CEO only
                    </span>
                </div>
            </header>

            <div className="flex gap-2 border-b border-border">
                <TabButton active={tab === 'online'} onClick={() => setTab('online')}>
                    <Wifi size={14} className="mr-1 inline" /> Online Now
                </TabButton>
                <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
                    <Activity size={14} className="mr-1 inline" /> Activity Log
                </TabButton>
            </div>

            {tab === 'online' ? <OnlineNowPanel /> : <ActivityLogPanel />}
        </div>
    );
}

function TabButton({
    active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Online Now
// ---------------------------------------------------------------------------

function OnlineNowPanel() {
    const [rows, setRows] = useState<OnlineUser[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await api.get<ApiEnvelope<OnlineUser[]>>('/api/activity-logs/online');
            if (!res.data.success) throw new Error(res.data.error || 'Request failed');
            setRows(res.data.data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load online users');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, ONLINE_REFRESH_MS);
        return () => clearInterval(id);
    }, [load]);

    const count = rows?.length ?? 0;

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                    <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="font-medium">{count} {count === 1 ? 'user' : 'users'} online</span>
                </div>
                <button
                    type="button"
                    onClick={load}
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                    Refresh
                </button>
            </div>

            {error && (
                <div className="m-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !rows ? (
                <SkeletonRows columns={4} />
            ) : rows && rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No users currently connected.
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                            <th className="w-12 px-4 py-2"></th>
                            <th className="px-4 py-2">Display Name</th>
                            <th className="px-4 py-2">Role</th>
                            <th className="px-4 py-2">Connections</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows?.map((u) => (
                            <tr key={u.id} className="border-b border-border/60 last:border-b-0">
                                <td className="px-4 py-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                                        {initialOf(u.display_name)}
                                    </div>
                                </td>
                                <td className="px-4 py-2">
                                    <div className="font-medium">{u.display_name}</div>
                                    <div className="text-xs text-muted-foreground">{u.email}</div>
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">{roleLabel(u.role)}</td>
                                <td className="px-4 py-2">
                                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                                        {u.connections} {u.connections === 1 ? 'tab' : 'tabs'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

function ActivityLogPanel() {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [action, setAction] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(1);

    const [rows, setRows] = useState<ActivityRow[] | null>(null);
    const [meta, setMeta] = useState<ListMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const reqSeq = useRef(0);

    // Debounce the email search to avoid a refetch on every keystroke.
    useEffect(() => {
        const id = setTimeout(() => setDebouncedSearch(search.trim()), 400);
        return () => clearTimeout(id);
    }, [search]);

    // Any filter change sends us back to page 1.
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, action, dateFrom, dateTo]);

    const load = useCallback(async () => {
        const seq = ++reqSeq.current;
        setLoading(true);
        setError(null);
        try {
            const params: Record<string, string | number> = { page, limit: PAGE_SIZE };
            if (debouncedSearch) params.search = debouncedSearch;
            if (action) params.action = action;
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;

            const res = await api.get<ApiEnvelope<ActivityRow[]>>('/api/activity-logs', { params });
            if (seq !== reqSeq.current) return;
            if (!res.data.success) throw new Error(res.data.error || 'Request failed');
            setRows(res.data.data);
            setMeta(res.data.meta || null);
        } catch (err) {
            if (seq !== reqSeq.current) return;
            setError(err instanceof Error ? err.message : 'Failed to load activity logs');
        } finally {
            if (seq === reqSeq.current) setLoading(false);
        }
    }, [page, debouncedSearch, action, dateFrom, dateTo]);

    useEffect(() => {
        load();
    }, [load]);

    const clearFilters = () => {
        setSearch('');
        setAction('');
        setDateFrom('');
        setDateTo('');
    };

    const totalPages = meta?.totalPages ?? 0;
    const hasFilters = useMemo(
        () => Boolean(search || action || dateFrom || dateTo),
        [search, action, dateFrom, dateTo],
    );

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by email…"
                    className="h-9 flex-1 min-w-[180px] rounded border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    className="h-9 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                    {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-9 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-9 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                    type="button"
                    onClick={clearFilters}
                    disabled={!hasFilters}
                    className="h-9 rounded border border-border px-3 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                >
                    Clear filters
                </button>
            </div>

            {error ? (
                <div className="m-4 flex items-center justify-between gap-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={load}
                        className="rounded border border-red-500/40 px-2 py-1 text-xs hover:bg-red-500/20"
                    >
                        Retry
                    </button>
                </div>
            ) : null}

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                            <th className="px-4 py-2">Timestamp</th>
                            <th className="px-4 py-2">User</th>
                            <th className="px-4 py-2">Action</th>
                            <th className="px-4 py-2">Resource</th>
                            <th className="px-4 py-2">Detail</th>
                            <th className="px-4 py-2">IP</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && !rows ? (
                            <SkeletonBodyRows columns={6} />
                        ) : rows && rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                                    No activity matches the current filters.
                                </td>
                            </tr>
                        ) : (
                            rows?.map((r) => (
                                <tr key={r.id} className="border-b border-border/60 last:border-b-0 align-top">
                                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                                        {formatTimestamp(r.created_at)}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{r.user_email}</div>
                                        <div className="text-xs text-muted-foreground">{roleLabel(r.user_role)}</div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={cn(
                                            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                                            ACTION_BADGE[r.action] || ACTION_BADGE.view,
                                        )}>
                                            {r.action}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-xs">
                                        {r.resource_type ? (
                                            <div>
                                                <div className="font-medium">{r.resource_type}</div>
                                                {r.resource_id && (
                                                    <div className="truncate text-muted-foreground" title={r.resource_id}>
                                                        {r.resource_id}
                                                    </div>
                                                )}
                                            </div>
                                        ) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="max-w-xs px-4 py-2 text-xs text-muted-foreground">
                                        <span className="block truncate" title={typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail ?? '')}>
                                            {formatDetail(r.detail)}
                                        </span>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                                        {r.ip_address || '—'}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                    {meta ? `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} total` : '—'}
                </span>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(p - 1, 1))}
                        disabled={page <= 1 || loading}
                        className="rounded border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        ← Previous
                    </button>
                    <button
                        type="button"
                        onClick={() => setPage((p) => (totalPages ? Math.min(p + 1, totalPages) : p + 1))}
                        disabled={loading || (totalPages > 0 && page >= totalPages)}
                        className="rounded border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        Next →
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function SkeletonRows({ columns }: { columns: number }) {
    return (
        <table className="w-full text-sm">
            <tbody>
                <SkeletonBodyRows columns={columns} />
            </tbody>
        </table>
    );
}

function SkeletonBodyRows({ columns }: { columns: number }) {
    return (
        <>
            {[0, 1, 2].map((i) => (
                <tr key={i} className="border-b border-border/60 last:border-b-0">
                    {Array.from({ length: columns }).map((_, c) => (
                        <td key={c} className="px-4 py-3">
                            <div className="h-4 animate-pulse rounded bg-muted" />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

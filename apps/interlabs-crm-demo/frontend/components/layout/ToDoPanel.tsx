'use client';

import { useEffect, useState } from 'react';
import { ListChecks, X } from 'lucide-react';

import { apiGet, apiPut } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type TodoItem = {
    id: string;
    title: string;
    description: string | null;
    deadline: string | null;
    status: 'open' | 'in_progress' | 'completed' | 'cancelled';
    related_module: string | null;
    related_entity_id: string | null;
};

/**
 * Right-side slide-over listing todo_items for the current user.
 *
 * Backend endpoint (`GET /api/todos`) is part of the planned global routes;
 * if the server returns an error the panel falls back to an empty state
 * rather than failing loudly.
 */
export function ToDoPanel() {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<TodoItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        apiGet<TodoItem[]>('/api/todos')
            .then(setItems)
            .catch(() => setItems([]))
            .finally(() => setLoading(false));
    }, [open]);

    async function toggle(item: TodoItem): Promise<void> {
        const nextStatus = item.status === 'completed' ? 'open' : 'completed';
        setItems((rows) => rows.map((r) =>
            r.id === item.id ? { ...r, status: nextStatus } : r,
        ));
        try {
            await apiPut(`/api/todos/${item.id}`, { status: nextStatus });
        } catch {
            // Revert on failure.
            setItems((rows) => rows.map((r) =>
                r.id === item.id ? { ...r, status: item.status } : r,
            ));
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="To-do panel"
                className="rounded-md p-2 hover:bg-accent"
            >
                <ListChecks size={18} />
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex">
                    <div
                        aria-hidden
                        onClick={() => setOpen(false)}
                        className="flex-1 bg-black/30"
                    />
                    <aside className="flex h-full w-96 flex-col border-l border-border bg-background shadow-xl">
                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <h2 className="text-sm font-semibold">To-Do</h2>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                className="rounded-md p-1 hover:bg-accent"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {loading && (
                                <p className="text-sm text-muted-foreground">Loading…</p>
                            )}
                            {!loading && items.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No open to-dos.
                                </p>
                            )}
                            <ul className="space-y-2">
                                {items.map((item) => (
                                    <li
                                        key={item.id}
                                        className="rounded-md border border-border p-3"
                                    >
                                        <label className="flex items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={item.status === 'completed'}
                                                onChange={() => toggle(item)}
                                                className="mt-0.5 h-4 w-4 rounded border-input"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className={cn(
                                                    'truncate text-sm font-medium',
                                                    item.status === 'completed'
                                                        && 'text-muted-foreground line-through',
                                                )}>
                                                    {item.title}
                                                </p>
                                                {item.description && (
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {item.description}
                                                    </p>
                                                )}
                                                {item.deadline && (
                                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                                        Due {formatDate(item.deadline)}
                                                    </p>
                                                )}
                                            </div>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </aside>
                </div>
            )}
        </>
    );
}

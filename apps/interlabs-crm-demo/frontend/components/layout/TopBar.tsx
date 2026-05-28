'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Settings, Sun } from 'lucide-react';

import { useThemeStore } from '@/stores/theme.store';
import { NotificationDropdown } from './NotificationDropdown';
import { ToDoPanel } from './ToDoPanel';

/**
 * TopBar. Left: breadcrumb-ish page title derived from the URL. Right:
 * theme toggle, Settings, To-Do, Notifications (order matches the spec).
 */
export function TopBar() {
    const pathname = usePathname();
    const theme = useThemeStore((s) => s.theme);
    const toggle = useThemeStore((s) => s.toggle);

    const title = deriveTitle(pathname);

    return (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4">
            <h1 className="text-sm font-semibold text-foreground">{title}</h1>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={toggle}
                    aria-label="Toggle theme"
                    className="rounded-md p-2 hover:bg-accent"
                    title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                >
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                <Link
                    href="/settings"
                    aria-label="Settings"
                    className="rounded-md p-2 hover:bg-accent"
                    title="Settings"
                >
                    <Settings size={18} />
                </Link>
                <ToDoPanel />
                <NotificationDropdown />
            </div>
        </header>
    );
}

function deriveTitle(pathname: string | null): string {
    if (!pathname) return 'Interlabs CRM';
    const seg = pathname.split('/').filter(Boolean);
    if (seg.length === 0) return 'Dashboard';
    const last = seg[seg.length - 1];
    return last
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

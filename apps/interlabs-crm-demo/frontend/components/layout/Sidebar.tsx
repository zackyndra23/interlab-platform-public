'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu } from 'lucide-react';

import { env } from '@/lib/env';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { useSidebarStore } from '@/stores/sidebar.store';
import { UserCard } from './UserCard';
import {
    SHARED_TOP, SHARED_GLOBAL, SETUP_ITEMS, navForRole, type NavItem,
} from './navConfig';

/**
 * Primary navigation rail.
 *
 * Collapsed state: icons only, tooltips via native `title` attribute so we
 * don't take a runtime dep on a tooltip library yet. (Swap to shadcn's
 * Tooltip when the shadcn port lands.)
 * Expanded state: icon + label.
 */
export function Sidebar() {
    const user = useAuthStore((s) => s.user);
    const { collapsed, setupOpen, toggleCollapsed, toggleSetup } = useSidebarStore();
    const pathname = usePathname();

    if (!user) return null;

    const moduleItems = navForRole(user.role);

    return (
        <aside
            className={cn(
                'flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width]',
                collapsed ? 'w-16' : 'w-64',
            )}
        >
            <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label="Toggle sidebar"
                    className="rounded-md p-2 hover:bg-accent"
                >
                    <Menu size={18} />
                </button>
                {!collapsed && (
                    <div className="flex items-center gap-2">
                        <Image src="/company-logo.jpeg" alt="logo" width={24} height={24} className="rounded" />
                        <span className="text-sm font-semibold">{env.appName}</span>
                    </div>
                )}
            </div>

            <UserCard user={user} collapsed={collapsed} />

            <nav className="flex-1 overflow-y-auto py-2">
                {SHARED_TOP.map((item) => (
                    <NavLink key={item.key} item={item} pathname={pathname} collapsed={collapsed} />
                ))}

                {moduleItems.length > 0 && (
                    <>
                        {!collapsed && <SectionLabel>Modules</SectionLabel>}
                        {moduleItems.map((item) => (
                            <NavLink key={item.key} item={item} pathname={pathname} collapsed={collapsed} />
                        ))}
                    </>
                )}

                {!collapsed && <SectionLabel>Shared</SectionLabel>}
                {SHARED_GLOBAL.map((item) => (
                    <NavLink key={item.key} item={item} pathname={pathname} collapsed={collapsed} />
                ))}
            </nav>

            {/* Lower section: Setup */}
            <div className="border-t border-border py-2">
                <button
                    type="button"
                    onClick={toggleSetup}
                    className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent',
                        collapsed && 'justify-center',
                    )}
                    aria-expanded={setupOpen}
                    title="Setup"
                >
                    <ChevronDown
                        size={16}
                        className={cn('transition-transform', setupOpen ? 'rotate-180' : 'rotate-0')}
                    />
                    {!collapsed && <span>Setup</span>}
                </button>
                {setupOpen && (
                    <div className="pl-2">
                        {SETUP_ITEMS.map((item) => (
                            <NavLink key={item.key} item={item} pathname={pathname} collapsed={collapsed} />
                        ))}
                    </div>
                )}
            </div>
        </aside>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {children}
        </p>
    );
}

function NavLink({
    item, pathname, collapsed,
}: {
    item: NavItem;
    pathname: string | null;
    collapsed: boolean;
}) {
    const Icon = item.icon;
    const active = pathname
        ? pathname === item.href || pathname.startsWith(`${item.href}/`)
        : false;
    return (
        <Link
            href={item.href}
            title={item.label}
            className={cn(
                'flex items-center gap-3 px-3 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                active && 'bg-accent font-medium text-accent-foreground',
                collapsed && 'justify-center',
            )}
        >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
        </Link>
    );
}

'use client';

import { AuthGuard } from './AuthGuard';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Master layout for every authenticated page. Wraps children in the
 * AuthGuard, renders the persistent sidebar + topbar, and reserves the
 * remaining viewport for page content.
 *
 * Pages mount inside `<main>` which owns its own scroll; the sidebar and
 * topbar remain fixed so list/table pages don't push the nav out of view.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
    return (
        <AuthGuard>
            <div className="flex h-screen w-screen overflow-hidden bg-background">
                <Sidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                    <TopBar />
                    <main className="flex-1 overflow-y-auto p-4">
                        {children}
                    </main>
                </div>
            </div>
        </AuthGuard>
    );
}

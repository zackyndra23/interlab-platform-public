import { AppShell } from '@/components/layout/AppShell';

/**
 * Layout for every authenticated route. The `(app)` segment is a Next.js
 * route group — the URL is unchanged, but routes inside this folder
 * inherit AppShell (AuthGuard + Sidebar + TopBar).
 *
 * Public routes like /login live outside this group, at /login directly.
 */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
    return <AppShell>{children}</AppShell>;
}

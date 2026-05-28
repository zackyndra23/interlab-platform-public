'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { apiGet } from '@/lib/api';
import { clearTokens, getAccessToken } from '@/lib/auth';
import { websocket } from '@/lib/websocket';
import type { UserProfile } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Wraps authenticated pages. Behaviour:
 *   1. If no access token in storage → redirect to /login.
 *   2. If token exists but auth store is idle → fetch /api/auth/me,
 *      populate the store, then open the WebSocket.
 *   3. Listens for the `auth:logout` event that api.ts emits when the
 *      refresh interceptor fails, so a revoked session bounces back to
 *      /login without a manual logout click.
 *
 * Renders a minimal placeholder while bootstrapping so children don't
 * see a half-authenticated state.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { user, status, setUser, clear, setStatus } = useAuthStore();

    useEffect(() => {
        const token = getAccessToken();
        if (!token) {
            clear();
            router.replace('/login');
            return;
        }
        if (status === 'idle' || status === 'unauthenticated') {
            setStatus('loading');
            (async () => {
                try {
                    const profile = await apiGet<UserProfile>('/api/auth/me');
                    setUser(profile);
                    websocket.connect();
                } catch {
                    clearTokens();
                    clear();
                    router.replace('/login');
                }
            })();
        }
        // Auto-logout on refresh failure (dispatched from api.ts).
        const onForcedLogout = () => {
            clearTokens();
            clear();
            websocket.disconnect();
            router.replace('/login');
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('auth:logout', onForcedLogout);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('auth:logout', onForcedLogout);
            }
        };
        // Intentionally omit store actions from deps; they're stable
        // Zustand setters that never change identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    // Redirect users who must change their password before accessing the app.
    useEffect(() => {
        if (user?.must_change_password && !pathname.startsWith('/change-password')) {
            router.replace('/change-password');
        }
    }, [user, pathname, router]);

    if (status !== 'authenticated' || !user) {
        return (
            <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">
                Loading…
            </div>
        );
    }
    return <>{children}</>;
}

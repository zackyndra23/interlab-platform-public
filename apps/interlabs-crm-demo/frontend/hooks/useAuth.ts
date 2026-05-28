'use client';

import { useAuthStore } from '@/stores/auth.store';
import type { UserProfile } from '@/lib/rbac';

/**
 * Returns the authenticated user + status. Components that need to render
 * based on the role call this; anonymous callers get `{ user: null,
 * status: 'unauthenticated' }`.
 */
export function useAuth(): {
    user: UserProfile | null;
    status: ReturnType<typeof useAuthStore.getState>['status'];
} {
    const user = useAuthStore((s) => s.user);
    const status = useAuthStore((s) => s.status);
    return { user, status };
}

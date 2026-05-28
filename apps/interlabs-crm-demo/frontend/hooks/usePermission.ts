'use client';

import { useAuthStore } from '@/stores/auth.store';
import { hasFeatureAccess } from '@/lib/rbac';

/**
 * UI-only feature gate. Returns `true` if the current user's role owns
 * the feature. Remember: the backend is authoritative; this helper is for
 * hiding menu items and disabling buttons, not for auth decisions.
 */
export function usePermission(
    feature: string,
    capability: Parameters<typeof hasFeatureAccess>[2] = 'view_own',
): boolean {
    const user = useAuthStore((s) => s.user);
    if (!user) return false;
    return hasFeatureAccess(user.role, feature, capability);
}

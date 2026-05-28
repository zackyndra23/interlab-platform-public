import { create } from 'zustand';

import type { UserProfile } from '@/lib/rbac';

/**
 * Auth store — holds the current user profile and bootstrap status.
 *
 * This store does NOT own token persistence. Tokens live in storage
 * (`lib/auth.ts`); the store only reflects the decoded session state
 * that every component cares about (the user object and a "did we
 * already try to bootstrap?" flag used by AuthGuard to avoid flashing
 * /login during the first /me round-trip).
 */

type Status = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

type AuthState = {
    user: UserProfile | null;
    status: Status;
    setUser: (u: UserProfile) => void;
    clear: () => void;
    setStatus: (s: Status) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    status: 'idle',
    setUser: (user) => set({ user, status: 'authenticated' }),
    clear: () => set({ user: null, status: 'unauthenticated' }),
    setStatus: (status) => set({ status }),
}));

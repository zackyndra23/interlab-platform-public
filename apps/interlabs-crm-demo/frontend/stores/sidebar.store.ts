import { create } from 'zustand';

/**
 * Sidebar collapse + submenu state.
 *
 * The `collapsed` bit is the user preference surfaced to the server via
 * user_preferences.sidebar_collapsed. We hydrate this store from the
 * /api/auth/me response when AuthGuard bootstraps, then persist changes
 * via PUT /api/users/:id (the settings path). Until that endpoint is
 * wired, the preference survives per-tab via the store only.
 */

type SidebarState = {
    collapsed: boolean;
    setupOpen: boolean;
    toggleCollapsed: () => void;
    setCollapsed: (v: boolean) => void;
    toggleSetup: () => void;
    setSetupOpen: (v: boolean) => void;
};

export const useSidebarStore = create<SidebarState>((set) => ({
    collapsed: false,
    setupOpen: false,
    toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
    setCollapsed: (collapsed) => set({ collapsed }),
    toggleSetup: () => set((s) => ({ setupOpen: !s.setupOpen })),
    setSetupOpen: (setupOpen) => set({ setupOpen }),
}));

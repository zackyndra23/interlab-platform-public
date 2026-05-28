import { create } from 'zustand';

/**
 * Theme store — drives `data-theme="light|dark"` on the <html> element.
 *
 * Persistence strategy:
 *   - Source of truth on the server: user_preferences.theme.
 *   - Local fallback: localStorage['theme'] so the ThemeBootstrap client
 *     component can flip the attribute before the /me round-trip
 *     completes.
 *   - Anonymous users (login page) get the stored-or-default value.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

export function readInitialTheme(): Theme {
    if (typeof window === 'undefined') return 'light';
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    return 'light';
}

type ThemeState = {
    theme: Theme;
    setTheme: (t: Theme) => void;
    toggle: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
    // Deterministic default for SSR + first client render. The persisted theme
    // is adopted post-mount by ThemeBootstrap (via setTheme) so server and
    // client initial markup match — reading localStorage here would cause a
    // hydration mismatch that throws in the production build (blank page).
    theme: 'light',
    setTheme: (theme) => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, theme);
            document.documentElement.setAttribute('data-theme', theme);
        }
        set({ theme });
    },
    toggle: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, next);
            document.documentElement.setAttribute('data-theme', next);
        }
        set({ theme: next });
    },
}));

'use client';

import { useEffect } from 'react';

import { useThemeStore, readInitialTheme } from '@/stores/theme.store';

/**
 * Applies the stored theme to <html data-theme="..."> after mount. Sits in
 * the root layout so every route (login included) picks up the user
 * preference. Renders nothing.
 *
 * The store initializes to a constant 'light' so SSR and the first client
 * render produce identical markup (no hydration mismatch — that mismatch
 * throws in the production build and blanks the page). Here, *after*
 * hydration, we adopt the persisted theme from localStorage.
 */
export function ThemeBootstrap(): null {
    const theme = useThemeStore((s) => s.theme);
    const setTheme = useThemeStore((s) => s.setTheme);

    // Adopt persisted theme once, post-mount (safe — runs after hydration).
    useEffect(() => {
        const stored = readInitialTheme();
        if (stored !== useThemeStore.getState().theme) setTheme(stored);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the <html data-theme> attribute in sync with the store.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return null;
}

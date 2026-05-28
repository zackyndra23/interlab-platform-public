'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Universal form-draft behaviour per IMPL_frontend §F9.
 *
 *   - Persists the current form values to `localStorage` under a stable key
 *     every 60 seconds (debounced) while the form is open.
 *   - Offers `loadDraft()` on mount so the page can show a "Resume draft?"
 *     banner and hydrate the form once the user agrees.
 *   - `clearDraft()` is called on successful submit so a completed record
 *     doesn't leave a stale draft behind.
 *
 * Keys are scoped as `draft:<formKey>:<recordId|'new'>` so a user editing
 * /sales/forecasts/:id doesn't collide with a new-forecast draft on the
 * same browser.
 */

const SAVE_INTERVAL_MS = 60_000;

export function useFormDraft<TValues>({
    formKey, recordId, currentValues, enabled = true,
}: {
    formKey: string;
    recordId: string | 'new';
    currentValues: TValues;
    enabled?: boolean;
}): {
    hasDraft: boolean;
    loadDraft: () => TValues | null;
    clearDraft: () => void;
    saveNow: () => void;
} {
    const storageKey = `draft:${formKey}:${recordId}`;
    const [hasDraft, setHasDraft] = useState(false);

    // Check for a pre-existing draft on first render only.
    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;
        const existing = window.localStorage.getItem(storageKey);
        setHasDraft(Boolean(existing));
    }, [enabled, storageKey]);

    // Periodic save. Keeps a ref to the latest values so the closure stays
    // stable while `currentValues` changes on every render.
    const valuesRef = useRef(currentValues);
    valuesRef.current = currentValues;

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => {
            try {
                window.localStorage.setItem(
                    storageKey,
                    JSON.stringify({
                        values: valuesRef.current,
                        saved_at: new Date().toISOString(),
                    }),
                );
            } catch { /* quota exceeded — ignore */ }
        }, SAVE_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, [enabled, storageKey]);

    function loadDraft(): TValues | null {
        if (typeof window === 'undefined') return null;
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as { values: TValues };
            return parsed.values;
        } catch { return null; }
    }

    function clearDraft(): void {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(storageKey);
        setHasDraft(false);
    }

    function saveNow(): void {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                storageKey,
                JSON.stringify({
                    values: valuesRef.current,
                    saved_at: new Date().toISOString(),
                }),
            );
        } catch { /* ignore */ }
    }

    return { hasDraft, loadDraft, clearDraft, saveNow };
}

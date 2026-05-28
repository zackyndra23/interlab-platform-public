'use client';

import { RotateCcw, X } from 'lucide-react';

/**
 * "Resume draft?" banner shown at the top of a form when `useFormDraft`
 * reports a stored draft. The caller handles the actual load / discard;
 * this component is purely presentational.
 */
export function DraftBanner({
    onResume, onDiscard,
}: {
    onResume: () => void;
    onDiscard: () => void;
}) {
    return (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="text-amber-700 dark:text-amber-300">
                Unsaved draft detected. Resume where you left off?
            </span>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={onResume}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                >
                    <RotateCcw size={12} />
                    Resume
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    aria-label="Discard draft"
                    className="rounded-md p-1 hover:bg-amber-500/20"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}

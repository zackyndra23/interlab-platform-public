'use client';

import { DatePicker } from './DatePicker';

/**
 * Pair of native date inputs — one "from", one "to". Emits null for
 * empty values so filters can be serialised as `?from=&to=` without
 * string trickery.
 */
export function DateRangePicker({
    from, to, onChange, disabled,
}: {
    from: string | null;
    to: string | null;
    onChange: (next: { from: string | null; to: string | null }) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <DatePicker
                value={from}
                max={to ?? undefined}
                disabled={disabled}
                onChange={(v) => onChange({ from: v, to })}
            />
            <span className="text-sm text-muted-foreground">to</span>
            <DatePicker
                value={to}
                min={from ?? undefined}
                disabled={disabled}
                onChange={(v) => onChange({ from, to: v })}
            />
        </div>
    );
}

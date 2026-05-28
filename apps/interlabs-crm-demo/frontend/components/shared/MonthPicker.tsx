'use client';

import { Input } from '@/components/ui/Input';

/**
 * Month picker for Masa Pajak (Indonesian tax-period month). Uses the
 * native <input type="month"> which produces `YYYY-MM`; we split into
 * { month, year } for the caller so the backend's `masa_pajak_month` +
 * `masa_pajak_year` columns can be populated directly.
 */
export function MonthPicker({
    value, onChange, disabled,
}: {
    value: { month: number | null; year: number | null };
    onChange: (next: { month: number | null; year: number | null }) => void;
    disabled?: boolean;
}) {
    const nativeValue = value.month && value.year
        ? `${value.year}-${String(value.month).padStart(2, '0')}`
        : '';

    return (
        <Input
            type="month"
            disabled={disabled}
            value={nativeValue}
            onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                    onChange({ month: null, year: null });
                    return;
                }
                const [yStr, mStr] = raw.split('-');
                onChange({ year: Number(yStr), month: Number(mStr) });
            }}
        />
    );
}

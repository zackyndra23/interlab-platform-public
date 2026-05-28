'use client';

import { Input } from '@/components/ui/Input';

export type Currency = 'IDR' | 'USD' | 'EUR';

/**
 * Numeric input + currency selector. The store value is always a number
 * (or null); the display value uses thousands separators. No Intl
 * parsing on keystroke — that eats quirky inputs like "1,0" mid-typing.
 * We keep it simple: store the raw number, let the caller format via
 * `formatCurrency(value, currency)` for display-only surfaces.
 */
export function CurrencyInput({
    value, onChange, currency, onCurrencyChange,
    currencyOptions = ['IDR', 'USD', 'EUR'],
    disabled,
}: {
    value: number | null;
    onChange: (next: number | null) => void;
    currency: Currency;
    onCurrencyChange: (next: Currency) => void;
    currencyOptions?: Currency[];
    disabled?: boolean;
}) {
    return (
        <div className="flex gap-2">
            <select
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value as Currency)}
                disabled={disabled}
                className="rounded-md border border-input bg-background px-2 text-sm"
            >
                {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                disabled={disabled}
                value={value ?? ''}
                onChange={(e) => {
                    const raw = e.target.value;
                    onChange(raw === '' ? null : Number(raw));
                }}
            />
        </div>
    );
}

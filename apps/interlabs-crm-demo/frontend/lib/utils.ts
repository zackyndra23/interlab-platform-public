import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict } from 'date-fns';

/** Tailwind-aware className concatenator (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

/** ISO-ish display: "2026-04-20" or "2026-04-20 14:32". */
export function formatDate(
    value: string | Date | null | undefined,
    opts: { withTime?: boolean } = {},
): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return opts.withTime ? format(d, 'yyyy-MM-dd HH:mm') : format(d, 'yyyy-MM-dd');
}

/** "5 min ago" helper used in notification / activity lists. */
export function relativeTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return formatDistanceToNowStrict(d, { addSuffix: true });
}

/**
 * IDR / USD / EUR display. IDR has no decimal places by convention; USD/EUR
 * use 2 decimal places. Uses Intl.NumberFormat with en-US so the thousands
 * separator is `,` (matching Indonesian ops tooling conventions for dashboards).
 */
export function formatCurrency(
    amount: number | string | null | undefined,
    currency: 'IDR' | 'USD' | 'EUR' = 'IDR',
): string {
    if (amount === null || amount === undefined || amount === '') return '';
    const n = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(n)) return '';
    const fractionDigits = currency === 'IDR' ? 0 : 2;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(n);
}

/**
 * Add N working days to a date, skipping Saturday (6) and Sunday (0). Matches
 * the backend's `utils/workingDays.js` so frontend SLA previews line up with
 * the server's deadlines. Intentionally ignores Indonesian public holidays —
 * same scope as backend.
 */
export function addWorkingDays(anchor: Date, days: number): Date {
    const d = new Date(anchor.getTime());
    let remaining = days;
    while (remaining > 0) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        if (day !== 0 && day !== 6) remaining -= 1;
    }
    return d;
}

export function maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return email;
    if (name.length <= 2) return `${name[0] || ''}*@${domain}`;
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

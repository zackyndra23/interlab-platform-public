import type {
    JenisSpt, PaymentStatus, RecordStatus, StatusSpt,
    TaxAuditAction, TaxCategory, TaxType,
} from './tax-types';

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Tax & Insurance status → StatusBadge variant mappings + enum lists used
 * by the list filter bar, the form selects, and the dashboard widgets.
 * Centralising the mapping keeps the four surfaces consistent.
 */

export const TAX_TYPES: TaxType[] = ['PPh 21', 'PPh 25', 'PPN', 'Others'];
export const TAX_CATEGORIES: TaxCategory[] = [
    'SSP Payment', 'SPT Reporting', 'Combined Record',
];
export const JENIS_SPT: JenisSpt[] = ['SPT Tahunan', 'SPT Masa'];
export const STATUS_SPT: StatusSpt[] = ['Normal', 'Pembetulan'];
export const PAYMENT_STATUSES: PaymentStatus[] = [
    'Unpaid', 'Paid', 'Pending', 'Failed',
];
export const RECORD_STATUSES: RecordStatus[] = [
    'Draft', 'Submitted', 'Verified', 'Archived',
];

/**
 * Required tax types surfaced on the dashboard "missing record" alert. Keep
 * aligned with tax.service.js §dashboardCurrentMasaPajak → `required`.
 */
export const REQUIRED_TAX_TYPES: TaxType[] = ['PPh 21', 'PPh 25', 'PPN'];

/**
 * Common Indonesian banks used for SSP payment. The backend accepts free
 * text so this is purely a dropdown convenience; "Other" lets users type.
 */
export const BANK_OPTIONS = [
    'BCA', 'Mandiri', 'BNI', 'BRI', 'CIMB Niaga', 'Permata', 'Danamon',
    'BTN', 'OCBC NISP', 'Panin', 'Maybank', 'Other',
] as const;

export function recordStatusVariant(s: RecordStatus): Variant {
    switch (s) {
        case 'Verified':  return 'success';
        case 'Submitted': return 'info';
        case 'Archived':  return 'muted';
        default:          return 'neutral'; // Draft
    }
}

export function paymentStatusVariant(s: PaymentStatus): Variant {
    switch (s) {
        case 'Paid':    return 'success';
        case 'Pending': return 'warning';
        case 'Failed':  return 'danger';
        default:        return 'muted'; // Unpaid
    }
}

export function taxCategoryVariant(c: TaxCategory): Variant {
    switch (c) {
        case 'SSP Payment':     return 'info';
        case 'SPT Reporting':   return 'warning';
        case 'Combined Record': return 'success';
        default:                return 'neutral';
    }
}

export function auditActionVariant(a: TaxAuditAction): Variant {
    switch (a) {
        case 'created':        return 'info';
        case 'status_changed': return 'warning';
        case 'archived':       return 'muted';
        default:               return 'neutral'; // updated
    }
}

/**
 * Conditional-field gating per MOD_tax_insurance §Conditional Field Logic.
 *   SSP Payment     → SPT fields hidden
 *   SPT Reporting   → SSP fields hidden
 *   Combined Record → all visible
 *
 * Used by the form (to hide sections) and by the service-side enforcement
 * mirror in tax.validators.js.
 */
export function showSptFields(c: TaxCategory): boolean {
    return c === 'SPT Reporting' || c === 'Combined Record';
}

export function showSspFields(c: TaxCategory): boolean {
    return c === 'SSP Payment' || c === 'Combined Record';
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * "March 2025" for Masa Pajak. Accepts the three shapes the backend emits
 * (month + year, ISO first-of-month, or null) and returns '—' when empty
 * so table cells stay aligned.
 */
export function formatMasaPajak(
    month: number | null | undefined,
    year: number | null | undefined,
): string {
    if (!month || !year) return '';
    if (month < 1 || month > 12) return String(year);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Format NPWP using the classic 15-digit separator layout
 * `NN.NNN.NNN.N-NNN.NNN`. If the input already contains separators or is
 * the 16-digit Coretax variant, fall back to returning the raw string so
 * users can still read their value.
 */
export function formatNpwp(raw: string | null | undefined): string {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length !== 15) return raw;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}`
        + `.${digits.slice(8, 9)}-${digits.slice(9, 12)}.${digits.slice(12, 15)}`;
}

/**
 * Year options for Tahun Pajak dropdown. Current year on top, then the
 * previous 10 + the next 1 — covers the common SPT correction window
 * without building a huge list. Callers may override.
 */
export function yearOptions(anchor: number = new Date().getUTCFullYear()): number[] {
    const years: number[] = [];
    for (let y = anchor + 1; y >= anchor - 10; y -= 1) years.push(y);
    return years;
}

import type {
    InvoiceCustomerStatus, InvoiceManufacturePaymentStatus,
    PoCustomerWorkflow, PrStatus,
} from './finance-types';

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Status → StatusBadge variant mapping for the Finance module.
 * Centralising the mapping keeps list, detail, and widget pages consistent.
 */

export function poCustomerWorkflowVariant(s: PoCustomerWorkflow): Variant {
    switch (s) {
        case 'completed': return 'success';
        case 'invoiced': return 'info';
        case 'active': return 'info';
        default: return 'neutral'; // registered
    }
}

export function prStatusVariant(s: PrStatus): Variant {
    return s === 'Processed' ? 'success' : 'neutral';
}

export function invoiceMfgPaymentVariant(s: InvoiceManufacturePaymentStatus): Variant {
    return s === 'Paid' ? 'success' : 'warning';
}

export function invoiceCustomerStatusVariant(s: InvoiceCustomerStatus): Variant {
    return s === 'Processed' ? 'success' : 'neutral';
}

/**
 * Is the supplied due_date overdue relative to "today"? Used on list
 * pages + widgets to surface outstanding manufacturer invoices.
 */
export function isOverdueDueDate(dueDate: string | null, today = new Date()): boolean {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return false;
    return due < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

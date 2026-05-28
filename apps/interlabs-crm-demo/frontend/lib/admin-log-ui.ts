import type {
    AwbStatus, DoStatus, ExpenseStatus,
    OperationalWorkflow, ReadyToDeliverStatus,
} from './admin-log-types';

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Status → StatusBadge variant mapping for the Admin & Log module.
 * Centralising the mapping keeps list, detail, and widget pages consistent.
 */

export function awbStatusVariant(s: AwbStatus): Variant {
    if (s === 'Arrived') return 'success';
    if (s === 'Processed') return 'info';
    return 'neutral'; // Registered
}

export function doStatusVariant(s: DoStatus): Variant {
    if (s === 'Arrived') return 'success';
    return 'info'; // Registered
}

export function expenseStatusVariant(s: ExpenseStatus): Variant {
    if (s === 'Paid') return 'success';
    if (s === 'Cancelled') return 'muted';
    return 'warning'; // Pending
}

export function operationalWorkflowVariant(s: OperationalWorkflow): Variant {
    if (s === 'reviewed') return 'success';
    if (s === 'submitted') return 'info';
    return 'neutral';
}

export function rtdStatusVariant(s: ReadyToDeliverStatus): Variant {
    if (s === 'dispatched') return 'success';
    if (s === 'acknowledged') return 'info';
    return 'danger'; // pending — drives the SLA alert
}

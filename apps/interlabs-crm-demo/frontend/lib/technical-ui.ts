import type {
    AdminLogResponse,
    BastWorkflow,
    InstallationWorkflowPhase,
    JobOrderWorkflow,
    PmWorkflow,
    Priority,
    QcFinalSubmitStatus,
    QcResult,
    QcReviewStatus,
    SparepartWorkflow,
} from './technical-types';

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Status → StatusBadge variant mapping for the Technical module.
 * Centralising the mapping keeps list, detail, and widget pages consistent.
 */

export function jobOrderWorkflowVariant(s: JobOrderWorkflow): Variant {
    switch (s) {
        case 'completed': return 'success';
        case 'active': return 'info';
        case 'cancelled': return 'muted';
        default: return 'neutral'; // draft
    }
}

export function priorityVariant(p: Priority | null): Variant {
    switch (p) {
        case 'Critical': return 'danger';
        case 'High': return 'warning';
        case 'Medium': return 'info';
        case 'Low': return 'muted';
        default: return 'neutral';
    }
}

export function installationPhaseVariant(p: InstallationWorkflowPhase): Variant {
    switch (p) {
        case 'completed': return 'success';
        case 'on_site':
        case 'commissioning': return 'info';
        case 'ready_to_deliver': return 'warning';
        default: return 'neutral';
    }
}

export function pmWorkflowVariant(s: PmWorkflow): Variant {
    switch (s) {
        case 'completed': return 'success';
        case 'in_progress': return 'info';
        default: return 'neutral';
    }
}

export function sparepartWorkflowVariant(s: SparepartWorkflow): Variant {
    switch (s) {
        case 'dispatched': return 'success';
        case 'ready': return 'warning';
        case 'workshop_check': return 'info';
        default: return 'neutral';
    }
}

export function adminLogResponseVariant(s: AdminLogResponse): Variant {
    switch (s) {
        case 'dispatched': return 'success';
        case 'acknowledged': return 'info';
        default: return 'warning'; // pending
    }
}

export function qcReviewVariant(s: QcReviewStatus): Variant {
    switch (s) {
        case 'Approved': return 'success';
        case 'Reviewed': return 'info';
        default: return 'neutral';
    }
}

export function qcFinalSubmitVariant(s: QcFinalSubmitStatus): Variant {
    return s === 'Submitted' ? 'success' : 'neutral';
}

export function qcResultVariant(s: QcResult | null): Variant {
    switch (s) {
        case 'Pass': return 'success';
        case 'Need Fix': return 'warning';
        case 'Reject': return 'danger';
        default: return 'muted';
    }
}

export function bastWorkflowVariant(s: BastWorkflow): Variant {
    switch (s) {
        case 'sent_to_finance': return 'success';
        case 'submitted': return 'info';
        default: return 'neutral';
    }
}

/**
 * Count working days elapsed since the given ISO timestamp. Used to flag
 * Installation/Sparepart records whose Ready-to-Deliver has been waiting
 * past the 2-working-day Admin & Log response SLA.
 */
export function workingDaysSince(iso: string | null, today = new Date()): number {
    if (!iso) return 0;
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) return 0;
    let count = 0;
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    while (cursor < end) {
        cursor.setDate(cursor.getDate() + 1);
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) count += 1;
    }
    return count;
}

/**
 * 30-day PO due-date reminder: true if po_due_date is within 30 calendar
 * days of today (inclusive). Mirrors the sla_monitor 30-day check.
 */
export function isPoDueSoon(dueDate: string | null, today = new Date()): boolean {
    if (!dueDate) return false;
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return false;
    const ms = d.getTime() - today.getTime();
    const days = ms / (24 * 60 * 60 * 1000);
    return days >= 0 && days <= 30;
}

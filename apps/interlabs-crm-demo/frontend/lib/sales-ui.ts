import type {
    CustomerStatus, ForecastStage, ForecastWorkflow,
    HppWorkflow, PurchaseRequestWorkflow,
    QuotationWorkflow, SalesPoWorkflow, SlaStepStatus,
} from './sales-types';

/**
 * Map module statuses to StatusBadge variants. Kept in one spot so every
 * list/detail page agrees on the colour semantics.
 */

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

export function customerVariant(s: CustomerStatus): Variant {
    return s === 'Active' ? 'success' : 'muted';
}

export function forecastWorkflowVariant(s: ForecastWorkflow): Variant {
    if (s === 'submitted') return 'info';
    if (s === 'closed') return 'muted';
    return 'neutral';
}

export function forecastStageVariant(s: ForecastStage): Variant {
    switch (s) {
        case 'Won': return 'success';
        case 'Lost': return 'muted';
        case 'Negotiation':
        case 'Proposal': return 'info';
        case 'Qualified': return 'neutral';
        default: return 'muted';
    }
}

export function quotationVariant(s: QuotationWorkflow): Variant {
    switch (s) {
        case 'accepted': return 'success';
        case 'rejected': return 'danger';
        case 'submitted':
        case 'revised': return 'info';
        default: return 'neutral';
    }
}

export function hppVariant(s: HppWorkflow): Variant {
    if (s === 'approved') return 'success';
    if (s === 'submitted') return 'info';
    return 'neutral';
}

export function salesPoVariant(s: SalesPoWorkflow): Variant {
    if (s === 'overdue') return 'danger';
    if (s === 'processed') return 'success';
    if (s === 'submitted') return 'info';
    return 'neutral';
}

export function prVariant(s: PurchaseRequestWorkflow): Variant {
    if (s === 'copied_to_finance') return 'success';
    if (s === 'submitted') return 'info';
    return 'neutral';
}

export function slaVariant(s: SlaStepStatus): Variant {
    return s === 'overdue' ? 'danger' : 'success';
}

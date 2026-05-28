/**
 * Tax & Insurance module entity types.
 *
 * Column names mirror the backend (migration 010 + backend/src/validators/
 * tax.validators.js + backend/src/services/tax.service.js) so form payloads
 * map 1:1 onto the API. Server-managed fields (record number, timestamps,
 * audit log rows) are read-only from the client and are stripped from
 * create/update payload types.
 */

import type { UUID, ISODate, ISODateTime, Currency } from './sales-types';

export type { UUID, ISODate, ISODateTime, Currency };

type AuditFields = {
    id: UUID;
    created_by: UUID | null;
    updated_by: UUID | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    deleted_at: ISODateTime | null;
};

// ---------------------------------------------------------------------------
// ENUMS (mirror migration 010 CHECK constraints + tax.validators.js)
// ---------------------------------------------------------------------------

export type TaxType = 'PPh 21' | 'PPh 25' | 'PPN' | 'Others';
export type TaxCategory = 'SSP Payment' | 'SPT Reporting' | 'Combined Record';
export type JenisSpt = 'SPT Tahunan' | 'SPT Masa';
export type StatusSpt = 'Normal' | 'Pembetulan';
export type PaymentStatus = 'Unpaid' | 'Paid' | 'Pending' | 'Failed';
export type RecordStatus = 'Draft' | 'Submitted' | 'Verified' | 'Archived';

export type TaxAuditAction =
    | 'created' | 'updated' | 'status_changed' | 'archived';

// ---------------------------------------------------------------------------
// TAX OPERATIONAL RECORD (tax_operational_records)
// ---------------------------------------------------------------------------

export type TaxOperationalRecord = AuditFields & {
    tax_operational_record_number: string;

    tax_type: TaxType;
    tax_category: TaxCategory;

    // Tax period — service persists all three; `masa_pajak` is first-of-month.
    masa_pajak: ISODate | null;
    masa_pajak_month: number | null;
    masa_pajak_year: number | null;
    tahun_pajak: number | null;

    // Taxpayer identity
    npwp: string;
    taxpayer_name: string | null;
    taxpayer_address: string | null;

    // SPT (only meaningful when tax_category ∈ {SPT Reporting, Combined Record})
    jenis_spt: JenisSpt | null;
    status_spt: StatusSpt | null;
    reporting_date: ISODate | null;

    // SSP / payment (only meaningful when tax_category ∈ {SSP Payment, Combined Record})
    billing_code: string | null;
    ntpn: string | null;
    ntb: string | null;
    stan: string | null;
    bank_name: string | null;
    payment_date: ISODate | null;
    amount: number | string | null;
    currency: Currency;

    payment_status: PaymentStatus;
    record_status: RecordStatus;
    pic_user_id: UUID | null;
    notes: string | null;
};

/**
 * Create payload. Conditional-field gating (Joi `when()` in the backend)
 * is enforced on submit — callers should omit SPT fields for SSP Payment
 * records and omit SSP fields for SPT Reporting records.
 */
export type TaxOperationalCreateInput = {
    tax_type: TaxType;
    tax_category: TaxCategory;
    npwp: string;

    masa_pajak?: ISODate | null;
    masa_pajak_month?: number | null;
    masa_pajak_year?: number | null;
    tahun_pajak?: number | null;

    taxpayer_name?: string | null;
    taxpayer_address?: string | null;

    jenis_spt?: JenisSpt | null;
    status_spt?: StatusSpt | null;
    reporting_date?: ISODate | null;

    billing_code?: string | null;
    ntpn?: string | null;
    ntb?: string | null;
    stan?: string | null;
    bank_name?: string | null;
    payment_date?: ISODate | null;
    amount?: number | null;
    currency?: Currency;

    payment_status?: PaymentStatus;
    record_status?: RecordStatus;
    pic_user_id?: UUID | null;
    notes?: string | null;

    attachment_ssp_file_ids?: UUID[];
    attachment_spt_file_ids?: UUID[];
    attachment_payment_file_ids?: UUID[];
    attachment_supporting_file_ids?: UUID[];
};

export type TaxOperationalUpdateInput = Partial<TaxOperationalCreateInput>;

export type TaxOperationalStatusChangeInput = {
    record_status?: RecordStatus;
    payment_status?: PaymentStatus;
    payment_date?: ISODate | null;
    reporting_date?: ISODate | null;
    note?: string | null;
};

export type TaxOperationalListQuery = {
    page?: number;
    limit?: number;
    search?: string;
    tax_type?: TaxType;
    tax_category?: TaxCategory;
    record_status?: RecordStatus;
    payment_status?: PaymentStatus;
    pic_user_id?: UUID;
    npwp?: string;
    masa_pajak_month?: number;
    masa_pajak_year?: number;
    tahun_pajak?: number;
    masa_pajak_from?: ISODate;
    masa_pajak_to?: ISODate;
};

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------

export type TaxAuditLogRow = {
    id: UUID;
    record_id: UUID;
    action: TaxAuditAction;
    changed_fields: Record<string, unknown> | null;
    actor_user_id: UUID | null;
    actor_role: string | null;
    created_at: ISODateTime;
};

export type TaxAuditListQuery = {
    page?: number;
    limit?: number;
    action?: TaxAuditAction;
    actor_user_id?: UUID;
    from?: ISODateTime;
    to?: ISODateTime;
};

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

export type DashboardMasaPajak = {
    masa_pajak_month: number;
    masa_pajak_year: number;
    by_tax_type: Array<{
        tax_type: TaxType;
        total: number;
        unpaid: number;
        draft: number;
    }>;
    missing_required_tax_types: TaxType[];
};

export type DashboardMonthlyPoint = {
    year: number;
    month: number;
    record_count: number;
    total_amount: number | string;
};

export type DashboardPpnPoint = {
    year: number;
    month: number;
    total_paid: number | string;
    spt_filed: boolean;
};

/**
 * NOTE: `id` here is the audit-log row id, not the tax record id — the
 * backend's dashboardRecentActivity query selects `al.id` from
 * tax_operational_audit_log. The record is identified by the human-readable
 * `tax_operational_record_number` instead. Don't route /tax/operational/:id
 * off this `id`.
 */
export type DashboardRecentActivityRow = {
    id: UUID;
    action: TaxAuditAction;
    actor_user_id: UUID | null;
    actor_role: string | null;
    created_at: ISODateTime;
    tax_operational_record_number: string;
    tax_type: TaxType;
    tax_category: TaxCategory;
    record_status: RecordStatus;
    payment_status: PaymentStatus;
};

export type DashboardPendingActions = {
    drafts_over_7d: Array<{
        id: UUID;
        tax_operational_record_number: string;
        tax_type: TaxType;
        created_at: ISODateTime;
    }>;
    unpaid_past_payment_date: Array<{
        id: UUID;
        tax_operational_record_number: string;
        tax_type: TaxType;
        payment_date: ISODate;
    }>;
    spt_missing_for_closed_masa_pajak: Array<{
        id: UUID;
        tax_operational_record_number: string;
        tax_type: TaxType;
        masa_pajak_month: number;
        masa_pajak_year: number;
    }>;
};

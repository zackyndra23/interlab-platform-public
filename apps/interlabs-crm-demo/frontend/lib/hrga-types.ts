/**
 * HRGA / Legal module entity types.
 *
 * Column names mirror the backend (migration 009 + hrga.validators.js /
 * hrga.service.js) so form payloads map 1:1 onto the API. Server-managed
 * fields (record numbers, compliance_flag, expired_at, reminder_*_at,
 * archived_at, superseded_by_id) are read-only from the client and are
 * stripped from create/update payload types.
 */

import type { UUID, ISODate, ISODateTime } from './sales-types';

export type { UUID, ISODate, ISODateTime };

type AuditFields = {
    id: UUID;
    created_by: UUID | null;
    updated_by: UUID | null;
    created_at: ISODateTime;
    updated_at: ISODateTime;
    deleted_at: ISODateTime | null;
};

// ---------------------------------------------------------------------------
// SHARED ENUMS (mirror validator + migration 009 CHECK constraints)
// ---------------------------------------------------------------------------

export type LegalDocumentStatus =
    | 'Draft' | 'Active' | 'Expiring Soon'
    | 'Expired' | 'Superseded' | 'Archived';

export type ComplianceFlag =
    | 'ok' | 'expiring_soon_90' | 'expiring_soon_30' | 'expired';

export type DocumentAccessScope = 'hrga_only' | 'all_roles' | 'specific_roles';
export type ArchiveAccessScope = 'hrga_only' | 'all_roles';
export type ArchiveSourceModule = 'legalitas' | 'company_letters' | 'other';
export type ArchiveReason = 'Superseded' | 'Expired' | 'Withdrawn' | 'Other';

export type LetterStatus =
    | 'Draft' | 'Under Review' | 'Final' | 'Sent' | 'Archived';

// ---------------------------------------------------------------------------
// LEGAL DOCUMENT (hrga_legal_documents)
// ---------------------------------------------------------------------------

export type LegalDocument = AuditFields & {
    legal_document_record_number: string;
    document_category: string | null;
    document_subcategory: string | null;
    document_name: string;
    document_number: string | null;
    document_year: number | null;
    issue_date: ISODate | null;
    expiry_date: ISODate | null;
    validity_period_start: ISODate | null;
    validity_period_end: ISODate | null;
    notary_name: string | null;
    related_customer_id: UUID | null;
    related_principal: string | null;
    pic_user_id: UUID | null;
    version_number: string | null;
    document_status: LegalDocumentStatus;
    tags: string[];
    notes: string | null;
    access_scope: DocumentAccessScope;
    superseded_by_id: UUID | null;
    archived_at: ISODateTime | null;
    reminder_90_days_at: ISODateTime | null;
    reminder_30_days_at: ISODateTime | null;
    expired_at: ISODateTime | null;
    compliance_flag: ComplianceFlag;
};

export type LegalDocumentCreateInput = {
    document_name: string;
    document_category?: string | null;
    document_subcategory?: string | null;
    document_number?: string | null;
    document_year?: number | null;
    issue_date?: ISODate | null;
    expiry_date?: ISODate | null;
    validity_period_start?: ISODate | null;
    validity_period_end?: ISODate | null;
    notary_name?: string | null;
    related_customer_id?: UUID | null;
    related_principal?: string | null;
    pic_user_id?: UUID | null;
    version_number?: string | null;
    document_status?: LegalDocumentStatus;
    tags?: string[];
    notes?: string | null;
    access_scope?: DocumentAccessScope;
    attachment_ids?: UUID[];
};

export type LegalDocumentUpdateInput = Partial<LegalDocumentCreateInput>;

/** Payload for POST /legal-documents/:id/supersede. */
export type LegalDocumentSupersedeInput = LegalDocumentUpdateInput & {
    supersede_reason?: string | null;
};

export type LegalDocumentSupersedeResult = {
    previous: { id: UUID; document_status: 'Superseded' };
    current: LegalDocument;
};

/** Payload for POST /legal-documents/:id/archive and /company-letters/:id/archive. */
export type ArchiveDocumentRequest = {
    archive_reason: ArchiveReason;
    notes?: string | null;
    access_scope?: ArchiveAccessScope;
};

// ---------------------------------------------------------------------------
// COMPANY LETTER (company_letters)
// ---------------------------------------------------------------------------

export type CompanyLetter = AuditFields & {
    letter_record_number: string;
    letter_type: string | null;
    letter_number: string | null;
    subject: string;
    related_employee_id: UUID | null;
    recipient_name: string | null;
    recipient_role_or_department: string | null;
    issue_date: ISODate | null;
    effective_date: ISODate | null;
    reference_number: string | null;
    signatory_user_id: UUID | null;
    template_reference_id: UUID | null;
    letter_status: LetterStatus;
    tags: string[];
    notes: string | null;
    access_scope: DocumentAccessScope;
};

export type CompanyLetterCreateInput = {
    subject: string;
    letter_type?: string | null;
    letter_number?: string | null;
    related_employee_id?: UUID | null;
    recipient_name?: string | null;
    recipient_role_or_department?: string | null;
    issue_date?: ISODate | null;
    effective_date?: ISODate | null;
    reference_number?: string | null;
    signatory_user_id?: UUID | null;
    template_reference_id?: UUID | null;
    letter_status?: LetterStatus;
    tags?: string[];
    notes?: string | null;
    access_scope?: DocumentAccessScope;
    attachment_ids?: UUID[];
};

export type CompanyLetterUpdateInput = Partial<CompanyLetterCreateInput>;

/** Payload for PUT /company-letters/:id/transition. */
export type CompanyLetterTransitionInput = {
    letter_status: LetterStatus;
    note?: string | null;
};

// ---------------------------------------------------------------------------
// LETTER TEMPLATE (letter_templates)
// ---------------------------------------------------------------------------

export type LetterTemplate = {
    id: UUID;
    template_name: string;
    letter_type: string;
    body_html: string;
    created_by: UUID | null;
    created_at: ISODateTime;
};

export type LetterTemplateCreateInput = {
    template_name: string;
    letter_type: string;
    body_html: string;
};

export type LetterTemplateUpdateInput = Partial<LetterTemplateCreateInput>;

// ---------------------------------------------------------------------------
// ARCHIVE (hrga_archive_records)
// ---------------------------------------------------------------------------

export type ArchiveRecord = {
    id: UUID;
    archive_record_number: string;
    source_module: ArchiveSourceModule;
    source_record_id: UUID;
    document_name: string | null;
    document_category: string | null;
    archive_reason: ArchiveReason;
    archived_by_user_id: UUID | null;
    archived_at: ISODateTime;
    notes: string | null;
    access_scope: ArchiveAccessScope;
    created_at: ISODateTime;
};

export type ArchiveCreateInput = {
    source_module: ArchiveSourceModule;
    source_record_id: UUID;
    document_name?: string | null;
    document_category?: string | null;
    archive_reason: ArchiveReason;
    notes?: string | null;
    access_scope?: ArchiveAccessScope;
    attachment_ids?: UUID[];
};

export type ArchiveUpdateInput = {
    document_name?: string | null;
    document_category?: string | null;
    archive_reason?: ArchiveReason;
    notes?: string | null;
    access_scope?: ArchiveAccessScope;
};

// ---------------------------------------------------------------------------
// SMART SEARCH
// ---------------------------------------------------------------------------

export type SmartSearchSource = 'legalitas' | 'company_letters' | 'archive';

export type SmartSearchResult = {
    source_module: SmartSearchSource;
    id: UUID;
    record_number: string;
    display_name: string | null;
    category: string | null;
    subcategory: string | null;
    document_number: string | null;
    issue_date: ISODate | null;
    expiry_date: ISODate | null;
    status: string | null;
    version: string | null;
    compliance_flag: ComplianceFlag | null;
    access_scope: DocumentAccessScope | ArchiveAccessScope;
    tags: string[] | null;
    created_at: ISODateTime;
};

export type SmartSearchQuery = {
    page?: number;
    limit?: number;
    keyword?: string;
    document_category?: string;
    document_subcategory?: string;
    document_number?: string;
    year?: number;
    issue_date_from?: ISODate;
    issue_date_to?: ISODate;
    expiry_date_from?: ISODate;
    expiry_date_to?: ISODate;
    pic_user_id?: UUID;
    related_employee_id?: UUID;
    related_customer_id?: UUID;
    notary_name?: string;
    status?: LegalDocumentStatus | LetterStatus;
    tag?: string;
    include_archive?: boolean;
};

// ---------------------------------------------------------------------------
// COMPLIANCE
// ---------------------------------------------------------------------------

export type ComplianceSummary = {
    ok: number;
    expiring_soon_90: number;
    expiring_soon_30: number;
    expired: number;
};

export type ComplianceExpiringRow = {
    id: UUID;
    legal_document_record_number: string;
    document_name: string;
    document_category: string | null;
    document_subcategory: string | null;
    expiry_date: ISODate | null;
    document_status: LegalDocumentStatus;
    compliance_flag: ComplianceFlag;
    pic_user_id: UUID | null;
    reminder_90_days_at: ISODateTime | null;
    reminder_30_days_at: ISODateTime | null;
    expired_at: ISODateTime | null;
};

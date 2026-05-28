import type {
    ArchiveReason,
    ComplianceFlag,
    LegalDocumentStatus,
    LetterStatus,
    SmartSearchSource,
} from './hrga-types';

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Status → StatusBadge variant mapping for the HRGA module. Centralising
 * the mapping keeps list, detail, search, and widget pages consistent.
 */

export function legalDocumentStatusVariant(s: LegalDocumentStatus): Variant {
    switch (s) {
        case 'Active': return 'success';
        case 'Expiring Soon': return 'warning';
        case 'Expired': return 'danger';
        case 'Superseded': return 'muted';
        case 'Archived': return 'muted';
        default: return 'neutral'; // Draft
    }
}

export function complianceFlagVariant(f: ComplianceFlag | null | undefined): Variant {
    switch (f) {
        case 'expired': return 'danger';
        case 'expiring_soon_30': return 'warning';
        case 'expiring_soon_90': return 'info';
        case 'ok': return 'success';
        default: return 'muted';
    }
}

export function complianceFlagLabel(f: ComplianceFlag | null | undefined): string {
    switch (f) {
        case 'expired': return 'Expired';
        case 'expiring_soon_30': return 'Expiring ≤30d';
        case 'expiring_soon_90': return 'Expiring ≤90d';
        case 'ok': return 'OK';
        default: return '—';
    }
}

export function letterStatusVariant(s: LetterStatus): Variant {
    switch (s) {
        case 'Sent': return 'success';
        case 'Final': return 'info';
        case 'Under Review': return 'warning';
        case 'Archived': return 'muted';
        default: return 'neutral'; // Draft
    }
}

export function archiveReasonVariant(r: ArchiveReason): Variant {
    switch (r) {
        case 'Expired': return 'danger';
        case 'Superseded': return 'info';
        case 'Withdrawn': return 'warning';
        default: return 'muted';
    }
}

export function smartSearchSourceLabel(s: SmartSearchSource): string {
    switch (s) {
        case 'legalitas': return 'Legalitas';
        case 'company_letters': return 'Letter';
        case 'archive': return 'Archive';
        default: return s;
    }
}

export function smartSearchSourceVariant(s: SmartSearchSource): Variant {
    switch (s) {
        case 'legalitas': return 'info';
        case 'company_letters': return 'success';
        case 'archive': return 'muted';
        default: return 'neutral';
    }
}

/**
 * Forward-only progression order for company letters. Used to grey out
 * transition options that would rewind state (mirrors the server-side
 * ORDER check in hrga.service.js.transitionCompanyLetter).
 */
export const LETTER_STATUS_ORDER: Record<LetterStatus, number> = {
    Draft: 0,
    'Under Review': 1,
    Final: 2,
    Sent: 3,
    Archived: 4,
};

/**
 * Days until an expiry date. Returns negative for past expiries. Used
 * in the compliance list + renewals widget for the "in N days" column.
 */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const todayAnchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((target.getTime() - todayAnchor.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Built-in Legalitas categories from MOD_hrga §LEGALITAS DOCUMENT REPOSITORY.
 * New categories are configurable server-side but this list drives the
 * dropdown on the create/edit form and the Smart Search filter.
 */
export const LEGAL_DOCUMENT_CATEGORIES = [
    'Akta Perusahaan',
    'BPJS',
    'Company Profile',
    'CSMS',
    'STP RI',
    'KADIN',
    'KTP Karyawan',
    'Laporan Audit & SPT Tahunan',
    'LOA Principle',
    'NIB',
    'NPWP',
    'SKT Pajak',
    'SKT Customer',
    'SPPKP',
    'Other',
] as const;

/**
 * Built-in Letter types from MOD_hrga §COMPANY LETTERS. Same note as
 * above on configurability — this feeds the Letter Type dropdown + search.
 */
export const LETTER_TYPES = [
    'Surat Edaran',
    'Surat Himbauan',
    'Surat Keterangan Karyawan',
    'Surat Pemberitahuan',
    'Surat Pengantar',
    'Surat Pengumuman',
    'Surat Pengunduran Diri',
    'Surat Permohonan Cuti',
    'Surat Permohonan Pinjaman',
    'Surat Pernyataan',
    'Surat Pernyataan Peraturan dan Kerahasiaan Perusahaan',
    'Surat Persetujuan',
    'Surat Teguran dan Peringatan',
    'Other',
] as const;

export const LEGAL_STATUSES: LegalDocumentStatus[] = [
    'Draft', 'Active', 'Expiring Soon', 'Expired', 'Superseded', 'Archived',
];

export const LETTER_STATUSES: LetterStatus[] = [
    'Draft', 'Under Review', 'Final', 'Sent', 'Archived',
];

export const ARCHIVE_REASONS: ArchiveReason[] = [
    'Superseded', 'Expired', 'Withdrawn', 'Other',
];

export const COMPLIANCE_FLAGS: ComplianceFlag[] = [
    'ok', 'expiring_soon_90', 'expiring_soon_30', 'expired',
];

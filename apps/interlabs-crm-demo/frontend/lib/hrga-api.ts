import { apiDelete, apiGet, apiList, apiPost, apiPut } from './api';
import type {
    ArchiveCreateInput, ArchiveDocumentRequest, ArchiveRecord, ArchiveUpdateInput,
    CompanyLetter, CompanyLetterCreateInput, CompanyLetterTransitionInput,
    CompanyLetterUpdateInput,
    ComplianceExpiringRow, ComplianceSummary,
    LegalDocument, LegalDocumentCreateInput, LegalDocumentSupersedeInput,
    LegalDocumentSupersedeResult, LegalDocumentUpdateInput,
    LetterTemplate, LetterTemplateCreateInput, LetterTemplateUpdateInput,
    SmartSearchQuery, SmartSearchResult,
    UUID,
} from './hrga-types';

/**
 * Typed wrappers around the /api/hrga/* endpoints.
 *
 * Endpoint shape (see backend/src/routes/hrga.routes.js):
 *   /search                          Smart Search
 *   /compliance/expiring             Expiring documents feed
 *   /compliance/summary              Counts by compliance_flag
 *   /legal-documents                 CRUD + :id/supersede + :id/archive
 *   /company-letters                 CRUD + :id/transition + :id/archive
 *   /letter-templates                CRUD
 *   /archive                         CRUD (mirror store)
 */

const BASE = '/api/hrga';

// ---------- LEGAL DOCUMENTS ----------
export const legalDocumentsApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<LegalDocument>(`${BASE}/legal-documents`, params),
    get: (id: UUID) => apiGet<LegalDocument>(`${BASE}/legal-documents/${id}`),
    create: (input: LegalDocumentCreateInput) =>
        apiPost<LegalDocument>(`${BASE}/legal-documents`, input),
    update: (id: UUID, input: LegalDocumentUpdateInput) =>
        apiPut<LegalDocument>(`${BASE}/legal-documents/${id}`, input),
    /** Insert a new Active version, mark current row Superseded + link. */
    supersede: (id: UUID, input: LegalDocumentSupersedeInput) =>
        apiPost<LegalDocumentSupersedeResult>(
            `${BASE}/legal-documents/${id}/supersede`, input,
        ),
    /** Mirror into hrga_archive_records + flip source row to Archived. */
    archive: (id: UUID, input: ArchiveDocumentRequest) =>
        apiPost<{ archive: ArchiveRecord; source: { id: UUID; document_status: 'Archived' } }>(
            `${BASE}/legal-documents/${id}/archive`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/legal-documents/${id}`),
};

// ---------- COMPANY LETTERS ----------
export const companyLettersApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<CompanyLetter>(`${BASE}/company-letters`, params),
    get: (id: UUID) => apiGet<CompanyLetter>(`${BASE}/company-letters/${id}`),
    create: (input: CompanyLetterCreateInput) =>
        apiPost<CompanyLetter>(`${BASE}/company-letters`, input),
    update: (id: UUID, input: CompanyLetterUpdateInput) =>
        apiPut<CompanyLetter>(`${BASE}/company-letters/${id}`, input),
    /** Forward-only Draft → Under Review → Final → Sent transition. */
    transition: (id: UUID, input: CompanyLetterTransitionInput) =>
        apiPut<CompanyLetter>(`${BASE}/company-letters/${id}/transition`, input),
    archive: (id: UUID, input: ArchiveDocumentRequest) =>
        apiPost<{ archive: ArchiveRecord; source: { id: UUID; letter_status: 'Archived' } }>(
            `${BASE}/company-letters/${id}/archive`, input,
        ),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/company-letters/${id}`),
};

// ---------- LETTER TEMPLATES ----------
export const letterTemplatesApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<LetterTemplate>(`${BASE}/letter-templates`, params),
    get: (id: UUID) => apiGet<LetterTemplate>(`${BASE}/letter-templates/${id}`),
    create: (input: LetterTemplateCreateInput) =>
        apiPost<LetterTemplate>(`${BASE}/letter-templates`, input),
    update: (id: UUID, input: LetterTemplateUpdateInput) =>
        apiPut<LetterTemplate>(`${BASE}/letter-templates/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/letter-templates/${id}`),
};

// ---------- ARCHIVE ----------
export const archiveApi = {
    list: (params?: Record<string, unknown>) =>
        apiList<ArchiveRecord>(`${BASE}/archive`, params),
    get: (id: UUID) => apiGet<ArchiveRecord>(`${BASE}/archive/${id}`),
    create: (input: ArchiveCreateInput) =>
        apiPost<ArchiveRecord>(`${BASE}/archive`, input),
    update: (id: UUID, input: ArchiveUpdateInput) =>
        apiPut<ArchiveRecord>(`${BASE}/archive/${id}`, input),
    remove: (id: UUID) =>
        apiDelete<{ id: UUID; deleted: boolean }>(`${BASE}/archive/${id}`),
};

// ---------- SMART SEARCH ----------
export const smartSearchApi = {
    search: (params: SmartSearchQuery) =>
        apiList<SmartSearchResult>(`${BASE}/search`, params as Record<string, unknown>),
};

// ---------- COMPLIANCE ----------
export const complianceApi = {
    expiring: (params?: { page?: number; limit?: number; within_days?: number; compliance_flag?: string }) =>
        apiList<ComplianceExpiringRow>(`${BASE}/compliance/expiring`, params),
    summary: () => apiGet<ComplianceSummary>(`${BASE}/compliance/summary`),
};

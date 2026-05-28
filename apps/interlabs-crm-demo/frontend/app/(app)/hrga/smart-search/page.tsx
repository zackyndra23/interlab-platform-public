'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DatePicker } from '@/components/shared/DatePicker';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { Input } from '@/components/ui/Input';
import { smartSearchApi } from '@/lib/hrga-api';
import {
    complianceFlagLabel, complianceFlagVariant,
    LEGAL_DOCUMENT_CATEGORIES, legalDocumentStatusVariant,
    letterStatusVariant,
    smartSearchSourceLabel, smartSearchSourceVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type {
    SmartSearchQuery, SmartSearchResult, SmartSearchSource,
} from '@/lib/hrga-types';

const STATUS_OPTIONS = [
    'Draft', 'Active', 'Expiring Soon', 'Expired', 'Superseded', 'Archived',
    'Under Review', 'Final', 'Sent',
];

function sourceHref(row: SmartSearchResult): string {
    switch (row.source_module) {
        case 'legalitas': return `/hrga/legalitas/${row.id}`;
        case 'company_letters': return `/hrga/company-letters/${row.id}`;
        case 'archive': return `/hrga/archive/${row.id}`;
        default: return '/hrga/smart-search';
    }
}

function renderStatus(row: SmartSearchResult): React.ReactNode {
    if (!row.status) return '—';
    if (row.source_module === 'legalitas') {
        return (
            <StatusBadge
                status={row.status}
                variant={legalDocumentStatusVariant(row.status as never)}
            />
        );
    }
    if (row.source_module === 'company_letters') {
        return (
            <StatusBadge
                status={row.status}
                variant={letterStatusVariant(row.status as never)}
            />
        );
    }
    return <StatusBadge status={row.status} variant="muted" />;
}

export default function SmartSearchPage() {
    const router = useRouter();
    const [rows, setRows] = useState<SmartSearchResult[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [loading, setLoading] = useState(false);

    // Filter state
    const [keyword, setKeyword] = useState('');
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [year, setYear] = useState<string>('');
    const [issueFrom, setIssueFrom] = useState('');
    const [issueTo, setIssueTo] = useState('');
    const [expiryFrom, setExpiryFrom] = useState('');
    const [expiryTo, setExpiryTo] = useState('');
    const [picUserId, setPicUserId] = useState<string | null>(null);
    const [relatedEmployeeId, setRelatedEmployeeId] = useState<string | null>(null);
    const [relatedCustomerId, setRelatedCustomerId] = useState<string | null>(null);
    const [notaryName, setNotaryName] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [tag, setTag] = useState('');
    const [includeArchive, setIncludeArchive] = useState(true);

    // Kick off search on demand rather than every keystroke so the long
    // Smart Search SQL doesn't run on every character.
    const buildQuery = useCallback((): SmartSearchQuery => ({
        page, limit,
        keyword: keyword || undefined,
        document_category: category || undefined,
        document_subcategory: subcategory || undefined,
        document_number: documentNumber || undefined,
        year: year ? Number(year) : undefined,
        issue_date_from: issueFrom || undefined,
        issue_date_to: issueTo || undefined,
        expiry_date_from: expiryFrom || undefined,
        expiry_date_to: expiryTo || undefined,
        pic_user_id: picUserId || undefined,
        related_employee_id: relatedEmployeeId || undefined,
        related_customer_id: relatedCustomerId || undefined,
        notary_name: notaryName || undefined,
        status: (statusFilter as SmartSearchQuery['status']) || undefined,
        tag: tag || undefined,
        include_archive: includeArchive,
    }), [
        page, limit, keyword, category, subcategory, documentNumber, year,
        issueFrom, issueTo, expiryFrom, expiryTo,
        picUserId, relatedEmployeeId, relatedCustomerId, notaryName,
        statusFilter, tag, includeArchive,
    ]);

    async function runSearch(): Promise<void> {
        setLoading(true);
        try {
            const res = await smartSearchApi.search(buildQuery());
            setRows(res.rows);
            setMeta({ total: res.meta?.total ?? res.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Search failed');
        } finally { setLoading(false); }
    }

    // Re-run when pagination changes (user already searched).
    useEffect(() => {
        if (rows.length > 0) runSearch();
        /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, [page, limit]);

    const columns = useMemo<ColumnDef<SmartSearchResult>[]>(() => [
        {
            header: 'Source', accessorKey: 'source_module',
            cell: ({ getValue }) => {
                const s = getValue() as SmartSearchSource;
                return (
                    <StatusBadge
                        status={smartSearchSourceLabel(s)}
                        variant={smartSearchSourceVariant(s)}
                    />
                );
            },
        },
        { header: 'Record #', accessorKey: 'record_number' },
        {
            header: 'Name / Subject', accessorKey: 'display_name',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Category', accessorKey: 'category',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Doc #', accessorKey: 'document_number',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Issue', accessorKey: 'issue_date',
            cell: ({ row }) => formatDate(row.original.issue_date) || '—',
        },
        {
            header: 'Expiry', accessorKey: 'expiry_date',
            cell: ({ row }) => formatDate(row.original.expiry_date) || '—',
        },
        {
            header: 'Status',
            cell: ({ row }) => renderStatus(row.original),
        },
        {
            header: 'Compliance', accessorKey: 'compliance_flag',
            cell: ({ row }) => {
                const f = row.original.compliance_flag;
                if (!f) return '—';
                return (
                    <StatusBadge
                        status={complianceFlagLabel(f)}
                        variant={complianceFlagVariant(f)}
                    />
                );
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="Open"
                        onClick={() => router.push(sourceHref(row.original))} />
                </div>
            ),
        },
    ], [router]);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Smart Search</h2>
                <p className="text-xs text-muted-foreground">
                    Unified search across Legalitas, Company Letters, and Archive. Role-gated: non-HRGA roles see only records flagged <code>all_roles</code>.
                </p>
            </div>

            <section className="rounded-md border border-border bg-card p-4">
                <div className="grid gap-3 md:grid-cols-3">
                    <div className="md:col-span-3">
                        <label className="text-xs text-muted-foreground">Keyword</label>
                        <Input
                            placeholder="Search across names, numbers, subject, notes, tags…"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { setPage(1); runSearch(); }
                            }}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Category</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">All</option>
                            {LEGAL_DOCUMENT_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Subcategory</label>
                        <Input
                            value={subcategory}
                            onChange={(e) => setSubcategory(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Document Number</label>
                        <Input
                            value={documentNumber}
                            onChange={(e) => setDocumentNumber(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Year</label>
                        <Input
                            type="number"
                            min={1900}
                            max={9999}
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">All</option>
                            {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Tag</label>
                        <Input value={tag} onChange={(e) => setTag(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Issue Date From</label>
                        <DatePicker value={issueFrom} onChange={(v) => setIssueFrom(v || '')} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Issue Date To</label>
                        <DatePicker value={issueTo} onChange={(v) => setIssueTo(v || '')} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Expiry Date From</label>
                        <DatePicker value={expiryFrom} onChange={(v) => setExpiryFrom(v || '')} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Expiry Date To</label>
                        <DatePicker value={expiryTo} onChange={(v) => setExpiryTo(v || '')} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Notary Name</label>
                        <Input value={notaryName}
                            onChange={(e) => setNotaryName(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">PIC</label>
                        <SearchDropdown
                            endpoint="/api/users"
                            labelKey="display_name"
                            value={picUserId}
                            onChange={setPicUserId}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Related Employee</label>
                        <SearchDropdown
                            endpoint="/api/users"
                            labelKey="display_name"
                            value={relatedEmployeeId}
                            onChange={setRelatedEmployeeId}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Related Customer</label>
                        <SearchDropdown
                            endpoint="/api/sales/customers"
                            labelKey="company_name"
                            value={relatedCustomerId}
                            onChange={setRelatedCustomerId}
                        />
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={includeArchive}
                            onChange={(e) => setIncludeArchive(e.target.checked)}
                        />
                        Include Archive
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
                            onClick={() => {
                                setKeyword(''); setCategory(''); setSubcategory('');
                                setDocumentNumber(''); setYear('');
                                setIssueFrom(''); setIssueTo('');
                                setExpiryFrom(''); setExpiryTo('');
                                setPicUserId(null); setRelatedEmployeeId(null);
                                setRelatedCustomerId(null);
                                setNotaryName(''); setStatusFilter(''); setTag('');
                                setIncludeArchive(true);
                                setRows([]); setMeta({ total: 0 });
                            }}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground"
                            onClick={() => { setPage(1); runSearch(); }}
                        >
                            Search
                        </button>
                    </div>
                </div>
            </section>

            <DataTable<SmartSearchResult>
                columns={columns}
                data={rows}
                loading={loading}
                page={page}
                limit={limit}
                total={meta.total}
                onPageChange={setPage}
                onLimitChange={(l) => { setLimit(l); setPage(1); }}
                emptyMessage="Enter a keyword or filter and press Search."
            />
        </div>
    );
}

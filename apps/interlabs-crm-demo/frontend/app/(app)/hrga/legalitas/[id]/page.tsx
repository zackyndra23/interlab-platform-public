'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Archive, History, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { legalDocumentsApi } from '@/lib/hrga-api';
import {
    complianceFlagLabel, complianceFlagVariant, legalDocumentStatusVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { LegalDocument } from '@/lib/hrga-types';

export default function LegalDocumentDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<LegalDocument | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await legalDocumentsApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const terminal = row.document_status === 'Superseded'
        || row.document_status === 'Archived';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.document_name}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.legal_document_record_number}
                        {row.document_category ? ` · ${row.document_category}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={row.document_status}
                        variant={legalDocumentStatusVariant(row.document_status)}
                    />
                    <StatusBadge
                        status={complianceFlagLabel(row.compliance_flag)}
                        variant={complianceFlagVariant(row.compliance_flag)}
                    />
                    <Button size="sm" variant="outline" disabled={terminal}
                        onClick={() => router.push(`/hrga/legalitas/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                    <Button size="sm" variant="outline" disabled={terminal}
                        onClick={() => router.push(`/hrga/legalitas/${row.id}/supersede`)}>
                        <History size={14} /> New Version
                    </Button>
                    <Button size="sm" variant="outline"
                        disabled={row.document_status === 'Archived'}
                        onClick={() => router.push(`/hrga/legalitas/${row.id}/archive`)}>
                        <Archive size={14} /> Archive
                    </Button>
                </div>
            </div>

            {row.superseded_by_id && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    Superseded by
                    <button
                        type="button"
                        className="ml-1 underline"
                        onClick={() => router.push(`/hrga/legalitas/${row.superseded_by_id}`)}
                    >
                        newer version
                    </button>
                    .
                </div>
            )}

            <DetailSection title="Identification" fields={[
                { label: 'Document Number', value: row.document_number },
                { label: 'Year', value: row.document_year },
                { label: 'Category', value: row.document_category },
                { label: 'Subcategory', value: row.document_subcategory },
                { label: 'Version', value: row.version_number },
                { label: 'Access Scope', value: row.access_scope },
            ]} />

            <DetailSection title="Validity" fields={[
                { label: 'Issue Date', value: formatDate(row.issue_date) },
                { label: 'Expiry Date', value: formatDate(row.expiry_date) },
                { label: 'Validity Start', value: formatDate(row.validity_period_start) },
                { label: 'Validity End', value: formatDate(row.validity_period_end) },
                { label: 'Reminder (90d)', value: formatDate(row.reminder_90_days_at) },
                { label: 'Reminder (30d)', value: formatDate(row.reminder_30_days_at) },
                { label: 'Expired At', value: formatDate(row.expired_at) },
                { label: 'Archived At', value: formatDate(row.archived_at) },
            ]} />

            <DetailSection title="Parties" fields={[
                { label: 'Notary', value: row.notary_name },
                { label: 'Related Principal', value: row.related_principal },
                { label: 'Related Customer', value: row.related_customer_id },
                { label: 'PIC', value: row.pic_user_id },
            ]} />

            <DetailSection title="Tags">
                {row.tags && row.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {row.tags.map((t) => (
                            <StatusBadge key={t} status={t} variant="muted" />
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                )}
            </DetailSection>

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

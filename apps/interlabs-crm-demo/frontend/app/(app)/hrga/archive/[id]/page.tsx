'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { archiveApi } from '@/lib/hrga-api';
import { archiveReasonVariant } from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { ArchiveRecord } from '@/lib/hrga-types';

export default function ArchiveRecordDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<ArchiveRecord | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        archiveApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'))
            .finally(() => setLoading(false));
    }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const sourceHref = row.source_module === 'legalitas'
        ? `/hrga/legalitas/${row.source_record_id}`
        : row.source_module === 'company_letters'
            ? `/hrga/company-letters/${row.source_record_id}`
            : null;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">
                        {row.document_name || row.archive_record_number}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {row.archive_record_number}
                        {row.document_category ? ` · ${row.document_category}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={row.archive_reason}
                        variant={archiveReasonVariant(row.archive_reason)}
                    />
                    {sourceHref && (
                        <Button size="sm" variant="outline"
                            onClick={() => router.push(sourceHref)}>
                            <ExternalLink size={14} /> Open source
                        </Button>
                    )}
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/hrga/archive/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Source" fields={[
                { label: 'Source Module', value: row.source_module },
                { label: 'Source Record ID', value: row.source_record_id },
                { label: 'Archived At', value: formatDate(row.archived_at, { withTime: true }) },
                { label: 'Archived By', value: row.archived_by_user_id },
                { label: 'Access Scope', value: row.access_scope },
                { label: 'Reason', value: row.archive_reason },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

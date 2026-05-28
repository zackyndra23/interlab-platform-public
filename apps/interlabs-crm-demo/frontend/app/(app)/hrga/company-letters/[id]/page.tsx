'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Archive, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { LetterTransitionPanel } from '@/components/hrga/LetterTransitionPanel';
import { companyLettersApi } from '@/lib/hrga-api';
import { letterStatusVariant } from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { CompanyLetter } from '@/lib/hrga-types';

export default function CompanyLetterDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<CompanyLetter | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await companyLettersApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    const archived = row.letter_status === 'Archived';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{row.subject}</h2>
                    <p className="text-xs text-muted-foreground">
                        {row.letter_record_number}
                        {row.letter_type ? ` · ${row.letter_type}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={row.letter_status}
                        variant={letterStatusVariant(row.letter_status)}
                    />
                    <Button size="sm" variant="outline" disabled={archived}
                        onClick={() => router.push(`/hrga/company-letters/${row.id}/edit`)}>
                        <Pencil size={14} /> Edit
                    </Button>
                    <Button size="sm" variant="outline" disabled={archived}
                        onClick={() => router.push(`/hrga/company-letters/${row.id}/archive`)}>
                        <Archive size={14} /> Archive
                    </Button>
                </div>
            </div>

            <LetterTransitionPanel letter={row} onTransitioned={load} />

            <DetailSection title="Identification" fields={[
                { label: 'Letter Number', value: row.letter_number },
                { label: 'Reference Number', value: row.reference_number },
                { label: 'Letter Type', value: row.letter_type },
                { label: 'Access Scope', value: row.access_scope },
            ]} />

            <DetailSection title="Parties" fields={[
                { label: 'Recipient Name', value: row.recipient_name },
                { label: 'Recipient Role / Dept.', value: row.recipient_role_or_department },
                { label: 'Related Employee', value: row.related_employee_id },
                { label: 'Signatory', value: row.signatory_user_id },
                { label: 'Template', value: row.template_reference_id },
            ]} />

            <DetailSection title="Dates" fields={[
                { label: 'Issue Date', value: formatDate(row.issue_date) },
                { label: 'Effective Date', value: formatDate(row.effective_date) },
                { label: 'Created', value: formatDate(row.created_at, { withTime: true }) },
                { label: 'Updated', value: formatDate(row.updated_at, { withTime: true }) },
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

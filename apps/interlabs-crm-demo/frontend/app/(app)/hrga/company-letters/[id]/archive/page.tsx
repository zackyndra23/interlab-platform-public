'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArchiveDocumentForm } from '@/components/hrga/ArchiveDocumentForm';
import { companyLettersApi } from '@/lib/hrga-api';
import type { CompanyLetter } from '@/lib/hrga-types';

export default function ArchiveCompanyLetterPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<CompanyLetter | null>(null);
    useEffect(() => {
        companyLettersApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Archive Company Letter</h2>
                <p className="text-xs text-muted-foreground">
                    {row.letter_record_number} · {row.subject}
                </p>
            </div>
            <ArchiveDocumentForm source="company_letters" record={row} />
        </div>
    );
}

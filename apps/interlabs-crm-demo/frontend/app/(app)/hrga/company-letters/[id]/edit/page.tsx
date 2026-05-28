'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CompanyLetterForm } from '@/components/hrga/CompanyLetterForm';
import { companyLettersApi } from '@/lib/hrga-api';
import type { CompanyLetter } from '@/lib/hrga-types';

export default function EditCompanyLetterPage() {
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
                <h2 className="text-lg font-semibold">Edit Company Letter</h2>
                <p className="text-xs text-muted-foreground">{row.letter_record_number}</p>
            </div>
            <CompanyLetterForm existing={row} />
        </div>
    );
}

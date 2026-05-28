'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArchiveDocumentForm } from '@/components/hrga/ArchiveDocumentForm';
import { legalDocumentsApi } from '@/lib/hrga-api';
import type { LegalDocument } from '@/lib/hrga-types';

export default function ArchiveLegalDocumentPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<LegalDocument | null>(null);
    useEffect(() => {
        legalDocumentsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Archive Legalitas Document</h2>
                <p className="text-xs text-muted-foreground">
                    {row.legal_document_record_number} · {row.document_name}
                </p>
            </div>
            <ArchiveDocumentForm source="legalitas" record={row} />
        </div>
    );
}

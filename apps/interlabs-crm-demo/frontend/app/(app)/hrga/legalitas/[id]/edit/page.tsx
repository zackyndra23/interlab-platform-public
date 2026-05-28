'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { LegalDocumentForm } from '@/components/hrga/LegalDocumentForm';
import { legalDocumentsApi } from '@/lib/hrga-api';
import type { LegalDocument } from '@/lib/hrga-types';

export default function EditLegalDocumentPage() {
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
                <h2 className="text-lg font-semibold">Edit Legalitas Document</h2>
                <p className="text-xs text-muted-foreground">{row.legal_document_record_number}</p>
            </div>
            <LegalDocumentForm existing={row} mode="edit" />
        </div>
    );
}

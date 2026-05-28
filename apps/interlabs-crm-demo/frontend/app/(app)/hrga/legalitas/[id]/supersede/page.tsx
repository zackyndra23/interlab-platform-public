'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { LegalDocumentForm } from '@/components/hrga/LegalDocumentForm';
import { legalDocumentsApi } from '@/lib/hrga-api';
import type { LegalDocument } from '@/lib/hrga-types';

/**
 * Supersede flow: prefills from the existing document, submits to the
 * dedicated /:id/supersede endpoint which inserts a new Active row and
 * marks the current row Superseded atomically.
 */
export default function SupersedeLegalDocumentPage() {
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
                <h2 className="text-lg font-semibold">New Version of Legalitas Document</h2>
                <p className="text-xs text-muted-foreground">
                    Superseding {row.legal_document_record_number} — {row.document_name}
                </p>
            </div>
            <LegalDocumentForm existing={row} mode="supersede" />
        </div>
    );
}

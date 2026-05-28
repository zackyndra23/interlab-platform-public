'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { QuotationForm } from '@/components/sales/QuotationForm';
import { quotationsApi } from '@/lib/sales-api';
import type { Quotation } from '@/lib/sales-types';

export default function EditQuotationPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<Quotation | null>(null);
    useEffect(() => {
        quotationsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Quotation</h2>
                <p className="text-xs text-muted-foreground">{row.quotation_record_number}</p>
            </div>
            <QuotationForm existing={row} />
        </div>
    );
}

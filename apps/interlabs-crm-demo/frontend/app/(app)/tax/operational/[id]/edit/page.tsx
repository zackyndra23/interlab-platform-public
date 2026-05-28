'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { TaxOperationalForm } from '@/components/tax/TaxOperationalForm';
import { taxOperationalApi } from '@/lib/tax-api';
import type { TaxOperationalRecord } from '@/lib/tax-types';

export default function EditTaxOperationalPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<TaxOperationalRecord | null>(null);

    useEffect(() => {
        taxOperationalApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);

    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Tax Record</h2>
                <p className="text-xs text-muted-foreground">
                    {row.tax_operational_record_number}
                </p>
            </div>
            <TaxOperationalForm existing={row} mode="edit" />
        </div>
    );
}

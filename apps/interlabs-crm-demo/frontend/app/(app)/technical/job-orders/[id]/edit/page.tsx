'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { JobOrderForm } from '@/components/technical/JobOrderForm';
import { jobOrdersApi } from '@/lib/technical-api';
import type { TechnicalJobOrder } from '@/lib/technical-types';

export default function EditJobOrderPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<TechnicalJobOrder | null>(null);
    useEffect(() => {
        jobOrdersApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Job Order</h2>
                <p className="text-xs text-muted-foreground">{row.technical_job_order_number}</p>
            </div>
            <JobOrderForm existing={row} />
        </div>
    );
}

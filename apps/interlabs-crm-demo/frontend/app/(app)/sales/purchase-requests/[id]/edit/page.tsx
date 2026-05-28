'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PurchaseRequestForm } from '@/components/sales/PurchaseRequestForm';
import { purchaseRequestsApi } from '@/lib/sales-api';
import type { PurchaseRequestSales } from '@/lib/sales-types';

export default function EditPurchaseRequestPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<PurchaseRequestSales | null>(null);
    useEffect(() => {
        purchaseRequestsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Purchase Request</h2>
                <p className="text-xs text-muted-foreground">{row.pr_record_number}</p>
            </div>
            <PurchaseRequestForm existing={row} />
        </div>
    );
}

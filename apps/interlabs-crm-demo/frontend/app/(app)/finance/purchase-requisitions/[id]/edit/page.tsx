'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PurchaseRequisitionForm } from '@/components/finance/PurchaseRequisitionForm';
import { purchaseRequisitionsApi } from '@/lib/finance-api';
import type { PurchaseRequisition } from '@/lib/finance-types';

export default function EditPurchaseRequisitionPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<PurchaseRequisition | null>(null);
    useEffect(() => {
        purchaseRequisitionsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Purchase Requisition</h2>
                <p className="text-xs text-muted-foreground">{row.pr_record_number}</p>
            </div>
            <PurchaseRequisitionForm existing={row} />
        </div>
    );
}

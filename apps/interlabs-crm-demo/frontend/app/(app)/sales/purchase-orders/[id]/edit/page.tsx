'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SalesPoForm } from '@/components/sales/SalesPoForm';
import { salesPoApi } from '@/lib/sales-api';
import type { SalesPurchaseOrder } from '@/lib/sales-types';

export default function EditSalesPoPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<SalesPurchaseOrder | null>(null);
    useEffect(() => {
        salesPoApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Sales PO</h2>
                <p className="text-xs text-muted-foreground">{row.po_record_number}</p>
            </div>
            <SalesPoForm existing={row} />
        </div>
    );
}

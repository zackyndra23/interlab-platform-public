'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PoCustomerForm } from '@/components/finance/PoCustomerForm';
import { poCustomersApi } from '@/lib/finance-api';
import type { PoCustomer } from '@/lib/finance-types';

export default function EditPoCustomerPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<PoCustomer | null>(null);
    useEffect(() => {
        poCustomersApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit PO Customer</h2>
                <p className="text-xs text-muted-foreground">{row.po_customer_record_number}</p>
            </div>
            <PoCustomerForm existing={row} />
        </div>
    );
}

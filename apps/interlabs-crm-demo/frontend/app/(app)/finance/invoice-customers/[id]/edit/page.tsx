'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { InvoiceCustomerForm } from '@/components/finance/InvoiceCustomerForm';
import { invoiceCustomersApi } from '@/lib/finance-api';
import type { InvoiceCustomer } from '@/lib/finance-types';

export default function EditInvoiceCustomerPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<InvoiceCustomer | null>(null);
    useEffect(() => {
        invoiceCustomersApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Invoice Customer</h2>
                <p className="text-xs text-muted-foreground">{row.invoice_customer_record_number}</p>
            </div>
            <InvoiceCustomerForm existing={row} />
        </div>
    );
}

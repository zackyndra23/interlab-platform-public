'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { InvoiceManufactureForm } from '@/components/finance/InvoiceManufactureForm';
import { invoiceManufacturesApi } from '@/lib/finance-api';
import type { InvoiceManufacture } from '@/lib/finance-types';

export default function EditInvoiceManufacturePage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<InvoiceManufacture | null>(null);
    useEffect(() => {
        invoiceManufacturesApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Invoice Manufacture</h2>
                <p className="text-xs text-muted-foreground">{row.invoice_manufacture_record_number}</p>
            </div>
            <InvoiceManufactureForm existing={row} />
        </div>
    );
}

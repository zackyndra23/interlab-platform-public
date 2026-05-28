'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomerForm } from '@/components/sales/CustomerForm';
import { customersApi } from '@/lib/sales-api';
import type { Customer } from '@/lib/sales-types';

export default function EditCustomerPage() {
    const params = useParams<{ id: string }>();
    const [customer, setCustomer] = useState<Customer | null>(null);

    useEffect(() => {
        customersApi.get(params.id)
            .then(setCustomer)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);

    if (!customer) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Customer</h2>
                <p className="text-xs text-muted-foreground">
                    {customer.customer_record_number}
                </p>
            </div>
            <CustomerForm existing={customer} />
        </div>
    );
}

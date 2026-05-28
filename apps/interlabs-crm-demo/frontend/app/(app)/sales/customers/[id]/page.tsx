'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { customersApi } from '@/lib/sales-api';
import { customerVariant } from '@/lib/sales-ui';
import { formatDate } from '@/lib/utils';
import type { Customer } from '@/lib/sales-types';

export default function CustomerDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        customersApi.get(params.id)
            .then((c) => { if (!cancelled) setCustomer(c); })
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [params.id]);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!customer) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{customer.company_name}</h2>
                    <p className="text-xs text-muted-foreground">
                        {customer.customer_record_number}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={customer.customer_status}
                        variant={customerVariant(customer.customer_status)}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/sales/customers/${customer.id}/edit`)}
                    >
                        <Pencil size={14} />
                        Edit
                    </Button>
                </div>
            </div>

            <DetailSection title="Company" fields={[
                { label: 'Trade Name', value: customer.trade_name },
                { label: 'NPWP', value: customer.npwp },
                { label: 'Website', value: customer.website },
                { label: 'Country', value: customer.country },
                { label: 'City', value: customer.city },
                { label: 'Address', value: customer.address, span: 2 },
            ]} />

            <DetailSection title="Contact" fields={[
                { label: 'Phone', value: customer.phone },
                { label: 'Email', value: customer.email },
                { label: 'PIC Name', value: customer.pic_name },
                { label: 'PIC Phone', value: customer.pic_phone },
                { label: 'PIC Email', value: customer.pic_email, span: 2 },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {customer.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>

            <DetailSection title="Audit" fields={[
                { label: 'Created', value: formatDate(customer.created_at, { withTime: true }) },
                { label: 'Updated', value: formatDate(customer.updated_at, { withTime: true }) },
            ]} />
        </div>
    );
}

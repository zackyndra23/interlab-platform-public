'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DeliveryOrderForm } from '@/components/admin-log/DeliveryOrderForm';
import { deliveryOrdersApi } from '@/lib/admin-log-api';
import type { DeliveryOrder } from '@/lib/admin-log-types';

export default function EditDeliveryOrderPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<DeliveryOrder | null>(null);
    useEffect(() => {
        deliveryOrdersApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Delivery Order</h2>
                <p className="text-xs text-muted-foreground">{row.do_record_number}</p>
            </div>
            <DeliveryOrderForm existing={row} />
        </div>
    );
}

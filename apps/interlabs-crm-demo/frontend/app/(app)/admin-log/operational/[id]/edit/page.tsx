'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { OperationalForm } from '@/components/admin-log/OperationalForm';
import { operationalApi } from '@/lib/admin-log-api';
import type { OperationalRecord } from '@/lib/admin-log-types';

export default function EditOperationalPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<OperationalRecord | null>(null);
    useEffect(() => {
        operationalApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Operational Entry</h2>
                <p className="text-xs text-muted-foreground">{row.operational_record_number}</p>
            </div>
            <OperationalForm existing={row} />
        </div>
    );
}

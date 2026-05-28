'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { InspectionQcForm } from '@/components/technical/InspectionQcForm';
import { inspectionQcApi } from '@/lib/technical-api';
import type { InspectionQcRecord } from '@/lib/technical-types';

export default function EditQcPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<InspectionQcRecord | null>(null);
    useEffect(() => {
        inspectionQcApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit QC Record</h2>
                <p className="text-xs text-muted-foreground">{row.qc_record_number}</p>
            </div>
            <InspectionQcForm existing={row} />
        </div>
    );
}

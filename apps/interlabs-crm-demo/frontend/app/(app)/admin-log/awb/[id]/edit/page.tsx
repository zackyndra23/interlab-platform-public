'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AwbForm } from '@/components/admin-log/AwbForm';
import { awbApi } from '@/lib/admin-log-api';
import type { AwbRecord } from '@/lib/admin-log-types';

export default function EditAwbPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<AwbRecord | null>(null);
    useEffect(() => {
        awbApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit AWB</h2>
                <p className="text-xs text-muted-foreground">{row.awb_record_number}</p>
            </div>
            <AwbForm existing={row} />
        </div>
    );
}

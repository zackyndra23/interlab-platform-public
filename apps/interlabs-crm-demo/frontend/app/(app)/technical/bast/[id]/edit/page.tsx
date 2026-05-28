'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BastForm } from '@/components/technical/BastForm';
import { bastApi } from '@/lib/technical-api';
import type { BastRecord } from '@/lib/technical-types';

export default function EditBastPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<BastRecord | null>(null);
    useEffect(() => {
        bastApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit BAST</h2>
                <p className="text-xs text-muted-foreground">{row.bast_record_number}</p>
            </div>
            <BastForm existing={row} />
        </div>
    );
}

'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SparepartForm } from '@/components/technical/SparepartForm';
import { sparepartsApi } from '@/lib/technical-api';
import type { SparepartRecord } from '@/lib/technical-types';

export default function EditSparepartPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<SparepartRecord | null>(null);
    useEffect(() => {
        sparepartsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Sparepart</h2>
                <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
            </div>
            <SparepartForm existing={row} />
        </div>
    );
}

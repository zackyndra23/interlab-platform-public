'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PmForm } from '@/components/technical/PmForm';
import { pmApi } from '@/lib/technical-api';
import type { PmRecord } from '@/lib/technical-types';

export default function EditPmPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<PmRecord | null>(null);
    useEffect(() => {
        pmApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit PM Record</h2>
                <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
            </div>
            <PmForm existing={row} />
        </div>
    );
}

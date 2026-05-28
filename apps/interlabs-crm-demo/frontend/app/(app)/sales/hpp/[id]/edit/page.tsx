'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { HppForm } from '@/components/sales/HppForm';
import { hppApi } from '@/lib/sales-api';
import type { HargaPokokPenjualan } from '@/lib/sales-types';

export default function EditHppPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<HargaPokokPenjualan | null>(null);
    useEffect(() => {
        hppApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit HPP</h2>
                <p className="text-xs text-muted-foreground">{row.hpp_record_number}</p>
            </div>
            <HppForm existing={row} />
        </div>
    );
}

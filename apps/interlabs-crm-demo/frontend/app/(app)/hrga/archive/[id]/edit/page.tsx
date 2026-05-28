'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArchiveRecordForm } from '@/components/hrga/ArchiveRecordForm';
import { archiveApi } from '@/lib/hrga-api';
import type { ArchiveRecord } from '@/lib/hrga-types';

export default function EditArchiveRecordPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<ArchiveRecord | null>(null);
    useEffect(() => {
        archiveApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Archive Entry</h2>
                <p className="text-xs text-muted-foreground">{row.archive_record_number}</p>
            </div>
            <ArchiveRecordForm existing={row} />
        </div>
    );
}

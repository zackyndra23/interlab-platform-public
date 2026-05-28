'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { InstallationForm } from '@/components/technical/InstallationForm';
import { installationsApi } from '@/lib/technical-api';
import type { InstallationRecord } from '@/lib/technical-types';

export default function EditInstallationPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<InstallationRecord | null>(null);
    useEffect(() => {
        installationsApi.get(params.id).then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);
    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Installation</h2>
                <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
            </div>
            <InstallationForm existing={row} />
        </div>
    );
}

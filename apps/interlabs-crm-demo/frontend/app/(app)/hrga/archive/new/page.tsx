'use client';

import { ArchiveRecordForm } from '@/components/hrga/ArchiveRecordForm';

export default function NewArchiveRecordPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Archive Entry</h2>
                <p className="text-xs text-muted-foreground">
                    For legalitas / company_letters sources, the source row will also be flipped to Archived. Prefer the Archive action on the source record for the normal flow.
                </p>
            </div>
            <ArchiveRecordForm />
        </div>
    );
}

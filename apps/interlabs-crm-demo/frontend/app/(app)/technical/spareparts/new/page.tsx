'use client';

import { SparepartForm } from '@/components/technical/SparepartForm';

export default function NewSparepartPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Sparepart</h2>
                <p className="text-xs text-muted-foreground">
                    Link the parent Sparepart Job Order and the inbound AWB for tracking.
                </p>
            </div>
            <SparepartForm />
        </div>
    );
}

'use client';

import { JobOrderForm } from '@/components/technical/JobOrderForm';

export default function NewJobOrderPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Technical Job Order</h2>
                <p className="text-xs text-muted-foreground">
                    Enter the PO, job type, and planning details. Record number is assigned on save.
                </p>
            </div>
            <JobOrderForm />
        </div>
    );
}

'use client';

import { PmForm } from '@/components/technical/PmForm';

export default function NewPmPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New PM Record</h2>
                <p className="text-xs text-muted-foreground">
                    Link to a PM-type Job Order; the PO is inherited unless overridden.
                </p>
            </div>
            <PmForm />
        </div>
    );
}

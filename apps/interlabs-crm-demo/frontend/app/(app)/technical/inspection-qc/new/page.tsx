'use client';

import { InspectionQcForm } from '@/components/technical/InspectionQcForm';

export default function NewQcPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New QC Record</h2>
                <p className="text-xs text-muted-foreground">
                    Draft a QC record. Use the Submit Review panel on the detail page
                    to advance the review and trigger PO → Inspected.
                </p>
            </div>
            <InspectionQcForm />
        </div>
    );
}

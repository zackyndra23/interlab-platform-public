'use client';

import { TaxOperationalForm } from '@/components/tax/TaxOperationalForm';

export default function NewTaxOperationalPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Tax Operational Record</h2>
                <p className="text-xs text-muted-foreground">
                    Capture SSP payment data, SPT reporting data, or a combined record. SPT and SSP fields appear based on the selected category.
                </p>
            </div>
            <TaxOperationalForm />
        </div>
    );
}

'use client';

import { CompanyLetterForm } from '@/components/hrga/CompanyLetterForm';

export default function NewCompanyLetterPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Company Letter</h2>
                <p className="text-xs text-muted-foreground">
                    Author the letter as a Draft. Progress to Under Review / Final / Sent via the transition panel on the detail page.
                </p>
            </div>
            <CompanyLetterForm />
        </div>
    );
}

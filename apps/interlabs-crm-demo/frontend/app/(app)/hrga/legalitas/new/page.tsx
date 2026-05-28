'use client';

import { LegalDocumentForm } from '@/components/hrga/LegalDocumentForm';

export default function NewLegalDocumentPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Legalitas Document</h2>
                <p className="text-xs text-muted-foreground">
                    Capture category, expiry, and attachments. Expiry sets the 90/30-day reminder anchors used by the compliance monitor.
                </p>
            </div>
            <LegalDocumentForm />
        </div>
    );
}

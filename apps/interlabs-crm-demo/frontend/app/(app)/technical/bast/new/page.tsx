'use client';

import { BastForm } from '@/components/technical/BastForm';

export default function NewBastPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New BAST</h2>
                <p className="text-xs text-muted-foreground">
                    Capture the completion narrative and attachments. Send to Finance from
                    the detail page to advance the master PO and create the invoice draft.
                </p>
            </div>
            <BastForm />
        </div>
    );
}

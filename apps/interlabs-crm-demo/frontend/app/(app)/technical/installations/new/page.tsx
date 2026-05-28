'use client';

import { InstallationForm } from '@/components/technical/InstallationForm';

export default function NewInstallationPage() {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">New Installation</h2>
                <p className="text-xs text-muted-foreground">
                    Pick the parent Technical Job Order; PO is derived from the Job Order
                    unless you override it.
                </p>
            </div>
            <InstallationForm />
        </div>
    );
}

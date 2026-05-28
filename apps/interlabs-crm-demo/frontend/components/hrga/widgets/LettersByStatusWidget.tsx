'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { companyLettersApi } from '@/lib/hrga-api';
import { LETTER_STATUSES, letterStatusVariant } from '@/lib/hrga-ui';
import type { LetterStatus } from '@/lib/hrga-types';

/**
 * Widget 3 (MOD_hrga §DASHBOARD WIDGETS): count of letters by status.
 * One round-trip per status using limit=1 so the server's `meta.total`
 * drives the display without pulling the row payload. When the dashboard
 * aggregate endpoint ships this collapses to a single call.
 */
export function LettersByStatusWidget() {
    const [counts, setCounts] = useState<Record<LetterStatus, number>>({
        Draft: 0,
        'Under Review': 0,
        Final: 0,
        Sent: 0,
        Archived: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const results = await Promise.all(
                    LETTER_STATUSES.map((s) =>
                        companyLettersApi.list({ limit: 1, letter_status: s })
                            .then((r) => [s, r.meta?.total ?? 0] as const)
                            .catch(() => [s, 0] as const),
                    ),
                );
                const next: Record<LetterStatus, number> = {
                    Draft: 0, 'Under Review': 0, Final: 0, Sent: 0, Archived: 0,
                };
                for (const [s, c] of results) next[s] = c;
                setCounts(next);
            } finally { setLoading(false); }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Letters by Status</h3>
                <Link href="/hrga/company-letters" className="text-xs text-primary hover:underline">
                    Open list
                </Link>
            </div>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                    {LETTER_STATUSES.map((s) => (
                        <li key={s} className="flex items-center justify-between px-3 py-2 text-sm">
                            <StatusBadge status={s} variant={letterStatusVariant(s)} />
                            <span className="font-semibold">{counts[s]}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

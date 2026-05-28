'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { StatusBadge } from '@/components/shared/StatusBadge';
import { companyLettersApi, legalDocumentsApi } from '@/lib/hrga-api';
import {
    legalDocumentStatusVariant, letterStatusVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type { CompanyLetter, LegalDocument } from '@/lib/hrga-types';

/**
 * Widget 2 (MOD_hrga §DASHBOARD WIDGETS): 5 most recent Legalitas
 * documents and 5 most recent Company Letters. Two columns side by side
 * so HRGA can eyeball both pipelines without switching tabs.
 */
export function RecentDocumentsWidget() {
    const [legal, setLegal] = useState<LegalDocument[]>([]);
    const [letters, setLetters] = useState<CompanyLetter[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [l, let_] = await Promise.all([
                    legalDocumentsApi.list({ page: 1, limit: 5 }),
                    companyLettersApi.list({ page: 1, limit: 5 }),
                ]);
                setLegal(l.rows);
                setLetters(let_.rows);
            } finally { setLoading(false); }
        })();
    }, []);

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Recent Documents</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                                Legalitas
                            </h4>
                            <Link href="/hrga/legalitas" className="text-xs text-primary hover:underline">
                                View all
                            </Link>
                        </div>
                        {legal.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No records.</p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border text-sm">
                                {legal.map((d) => (
                                    <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                        <Link href={`/hrga/legalitas/${d.id}`}
                                            className="min-w-0 flex-1 truncate hover:underline">
                                            <span className="font-medium">{d.document_name}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                {d.legal_document_record_number}
                                            </span>
                                        </Link>
                                        <StatusBadge
                                            status={d.document_status}
                                            variant={legalDocumentStatusVariant(d.document_status)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                                Company Letters
                            </h4>
                            <Link href="/hrga/company-letters" className="text-xs text-primary hover:underline">
                                View all
                            </Link>
                        </div>
                        {letters.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No records.</p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border text-sm">
                                {letters.map((l) => (
                                    <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                        <Link href={`/hrga/company-letters/${l.id}`}
                                            className="min-w-0 flex-1 truncate hover:underline">
                                            <span className="font-medium">{l.subject}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                {formatDate(l.issue_date) || '—'}
                                            </span>
                                        </Link>
                                        <StatusBadge
                                            status={l.letter_status}
                                            variant={letterStatusVariant(l.letter_status)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

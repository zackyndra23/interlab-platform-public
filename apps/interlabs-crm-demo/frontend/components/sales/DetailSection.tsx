'use client';

import type React from 'react';

/**
 * Read-only field grid used on detail pages. Accepts an array of
 * { label, value } pairs and renders a responsive 2-column definition
 * list. Missing / empty values render as "—".
 */

export type DetailField = {
    label: string;
    value: React.ReactNode;
    span?: 1 | 2; // column span on md+
};

export function DetailSection({
    title, fields, children,
}: {
    title?: string;
    fields?: DetailField[];
    children?: React.ReactNode;
}) {
    return (
        <section className="rounded-md border border-border bg-card p-4">
            {title && <h3 className="mb-3 text-sm font-semibold">{title}</h3>}
            {fields && (
                <div className="grid gap-3 md:grid-cols-2">
                    {fields.map((f, idx) => (
                        <div
                            key={idx}
                            className={f.span === 2 ? 'md:col-span-2' : ''}
                        >
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                {f.label}
                            </dt>
                            <dd className="mt-0.5 text-sm">
                                {isEmpty(f.value) ? (
                                    <span className="text-muted-foreground">—</span>
                                ) : f.value}
                            </dd>
                        </div>
                    ))}
                </div>
            )}
            {children}
        </section>
    );
}

function isEmpty(v: React.ReactNode): boolean {
    return v === null || v === undefined || v === '';
}

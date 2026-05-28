'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Package, Search } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * F7 shared dashboard widget — PO Quick Search card.
 *
 * Spec: "search bar → navigates to PO Tracking result". Submitting the
 * form pushes /po-tracking?po=<urlencoded number>; the PO Tracking page
 * reads the query param on mount and runs the search automatically.
 */
export function PoQuickSearchCard() {
    const router = useRouter();
    const [poNumber, setPoNumber] = useState('');

    function onSubmit(e: React.FormEvent): void {
        e.preventDefault();
        const trimmed = poNumber.trim();
        if (!trimmed) return;
        router.push(`/po-tracking?po=${encodeURIComponent(trimmed)}`);
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Package size={14} /> PO Quick Search
                </h3>
                <span className="text-xs text-muted-foreground">
                    Latest 3 movements
                </span>
            </div>
            <form onSubmit={onSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search
                        size={14}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        placeholder="Enter PO number…"
                        className="pl-8"
                    />
                </div>
                <Button type="submit" size="sm" disabled={!poNumber.trim()}>
                    Search
                </Button>
            </form>
        </section>
    );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Widget 4 (MOD_hrga §DASHBOARD WIDGETS): inline search bar. Enter or
 * click Search jumps to /hrga/smart-search with the keyword prefilled
 * via querystring so the full search page can hydrate its state.
 */
export function SmartSearchQuickAccessWidget() {
    const router = useRouter();
    const [keyword, setKeyword] = useState('');

    function submit(): void {
        const q = keyword.trim();
        if (!q) {
            router.push('/hrga/smart-search');
            return;
        }
        router.push(`/hrga/smart-search?keyword=${encodeURIComponent(q)}`);
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Smart Search</h3>
            <p className="mb-3 text-xs text-muted-foreground">
                Search across Legalitas, Company Letters, and the Archive in one query.
            </p>
            <div className="flex items-center gap-2">
                <Input
                    placeholder="Try: NPWP, LOA Principle, Surat Edaran…"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit();
                    }}
                />
                <Button size="sm" onClick={submit}>
                    <Search size={14} />
                    Search
                </Button>
            </div>
        </section>
    );
}

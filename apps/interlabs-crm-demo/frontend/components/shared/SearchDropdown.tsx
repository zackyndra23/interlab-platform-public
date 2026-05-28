'use client';

import * as React from 'react';

import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';

/**
 * Debounced async dropdown for relational lookups (customer, user,
 * engineer, etc.). Hits any backend list endpoint that accepts `?search=`
 * and returns an envelope with `rows` matching `{ [valueKey], [labelKey] }`.
 *
 * Single-select today. `isMulti` is accepted but treated as single — a
 * future shadcn port of MultiSelect slots in without changing call sites.
 */

export type SearchDropdownProps = {
    endpoint: string;
    valueKey?: string;
    labelKey?: string;
    value: string | null;
    onChange: (next: string | null) => void;
    placeholder?: string;
    disabled?: boolean;
    isMulti?: boolean;
};

type Row = Record<string, unknown>;

export function SearchDropdown({
    endpoint, valueKey = 'id', labelKey = 'display_name',
    value, onChange, placeholder = 'Search…', disabled,
}: SearchDropdownProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [rows, setRows] = React.useState<Row[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);

    // Debounce query → API call.
    React.useEffect(() => {
        if (!open) return;
        const handle = setTimeout(async () => {
            setLoading(true);
            try {
                const data = await apiGet<Row[] | { rows: Row[] }>(
                    endpoint, { search: query, limit: 25 },
                );
                const list = Array.isArray(data) ? data : (data.rows || []);
                setRows(list);
            } catch {
                setRows([]);
            } finally {
                setLoading(false);
            }
        }, 250);
        return () => clearTimeout(handle);
    }, [endpoint, query, open]);

    function pick(row: Row): void {
        const nextValue = row[valueKey] as string;
        const nextLabel = String(row[labelKey] ?? nextValue);
        setSelectedLabel(nextLabel);
        onChange(nextValue);
        setOpen(false);
        setQuery('');
    }

    const display = selectedLabel || (value ? value : '');

    return (
        <div className="relative">
            <Input
                readOnly
                disabled={disabled}
                value={display}
                placeholder={placeholder}
                onClick={() => !disabled && setOpen(true)}
                onFocus={() => !disabled && setOpen(true)}
            />
            {open && (
                <div className={cn(
                    'absolute left-0 right-0 top-11 z-30 rounded-md border border-border',
                    'bg-popover text-popover-foreground shadow-lg',
                )}>
                    <div className="border-b border-border p-2">
                        <Input
                            autoFocus
                            value={query}
                            placeholder="Type to search…"
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <ul className="max-h-64 overflow-y-auto">
                        {loading && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>
                        )}
                        {!loading && rows.length === 0 && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
                        )}
                        {!loading && rows.map((row) => (
                            <li key={String(row[valueKey])}>
                                <button
                                    type="button"
                                    onClick={() => pick(row)}
                                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                                >
                                    {String(row[labelKey] ?? row[valueKey])}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="flex justify-end border-t border-border p-2">
                        <button
                            type="button"
                            onClick={() => { onChange(null); setSelectedLabel(null); setOpen(false); }}
                            className="text-xs text-muted-foreground hover:underline"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

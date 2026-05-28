'use client';

import * as React from 'react';
import {
    type ColumnDef,
    type SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Shared paginated + sortable + searchable table. Keeps the TanStack
 * Table dep contained here so module pages don't each import @tanstack
 * directly. Pagination is server-side: pass `page`, `limit`, `total`,
 * and page-change callbacks; the component doesn't slice client-side.
 */

const PAGE_SIZES = [25, 50, 75, 100] as const;

export type DataTableProps<TData extends Record<string, unknown>> = {
    columns: ColumnDef<TData, unknown>[];
    data: TData[];
    loading?: boolean;
    emptyMessage?: string;

    // Pagination (server-side).
    page: number;
    limit: number;
    total: number;
    onPageChange?: (page: number) => void;
    onLimitChange?: (limit: number) => void;

    // Search (debounced in the caller — this component emits onSearch
    // on each keystroke; callers usually wrap in a debounce).
    searchPlaceholder?: string;
    searchValue?: string;
    onSearch?: (value: string) => void;

    onExport?: () => void;

    // Optional slot rendered above the header row (filter bar).
    filterBar?: React.ReactNode;
};

export function DataTable<TData extends Record<string, unknown>>({
    columns, data, loading, emptyMessage = 'No records',
    page, limit, total, onPageChange, onLimitChange,
    searchPlaceholder = 'Search…',
    searchValue, onSearch, onExport,
    filterBar,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = React.useState<SortingState>([]);

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        manualPagination: true,
    });

    const pageCount = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 items-center gap-2">
                    {onSearch && (
                        <div className="relative w-full max-w-xs">
                            <Search
                                size={14}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                value={searchValue ?? ''}
                                onChange={(e) => onSearch(e.target.value)}
                                placeholder={searchPlaceholder}
                                className="pl-8"
                            />
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {onExport && (
                        <Button variant="outline" size="sm" onClick={onExport}>
                            <Download size={14} />
                            Export
                        </Button>
                    )}
                </div>
            </div>

            {filterBar && <div>{filterBar}</div>}

            <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted text-muted-foreground">
                        {table.getHeaderGroups().map((hg) => (
                            <tr key={hg.id}>
                                {hg.headers.map((h) => (
                                    <th
                                        key={h.id}
                                        className={cn(
                                            'px-3 py-2 text-left font-medium',
                                            h.column.getCanSort() && 'cursor-pointer select-none',
                                        )}
                                        onClick={h.column.getToggleSortingHandler()}
                                    >
                                        <span className="inline-flex items-center gap-1">
                                            {flexRender(h.column.columnDef.header, h.getContext())}
                                            {h.column.getCanSort() && (
                                                <SortIcon state={h.column.getIsSorted()} />
                                            )}
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && data.length === 0 && (
                            <tr>
                                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                                    {emptyMessage}
                                </td>
                            </tr>
                        )}
                        {!loading && table.getRowModel().rows.map((row) => (
                            <tr key={row.id} className="border-t border-border hover:bg-accent/40">
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id} className="px-3 py-2">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rows per page</span>
                    <select
                        className="rounded-md border border-input bg-background px-2 py-1"
                        value={limit}
                        onChange={(e) => onLimitChange?.(Number(e.target.value))}
                    >
                        {PAGE_SIZES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                        Page {page} of {pageCount} · {total} records
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => onPageChange?.(page - 1)}
                    >
                        Prev
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() => onPageChange?.(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
}

function SortIcon({ state }: { state: false | 'asc' | 'desc' }) {
    if (state === 'asc') return <ArrowUp size={12} />;
    if (state === 'desc') return <ArrowDown size={12} />;
    return <ArrowUpDown size={12} className="opacity-50" />;
}

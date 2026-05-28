'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from './IconButton';

export type RepeaterFieldKind = 'text' | 'number' | 'date';

export type RepeaterField<TRow> = {
    name: keyof TRow & string;
    label: string;
    kind?: RepeaterFieldKind;
    placeholder?: string;
    /** When provided, renders a custom cell instead of a plain input. */
    render?: (row: TRow, update: (patch: Partial<TRow>) => void) => React.ReactNode;
    widthClass?: string;
};

export type RepeaterTableProps<TRow extends Record<string, unknown>> = {
    fields: RepeaterField<TRow>[];
    value: TRow[];
    onChange: (rows: TRow[]) => void;
    /** Factory for the new row inserted when the user clicks "Add". */
    newRow: () => TRow;
    addLabel?: string;
    maxRows?: number;
    disabled?: boolean;
};

/**
 * Inline editable tabular input — used for line items, contacts, etc.
 * Each column may declare a `kind` (text / number / date) or a custom
 * `render` for relational pickers. Remove-row action is an icon-only
 * button per F9 universal rules.
 */
export function RepeaterTable<TRow extends Record<string, unknown>>({
    fields, value, onChange, newRow, addLabel = 'Add row', maxRows, disabled,
}: RepeaterTableProps<TRow>) {
    function update(idx: number, patch: Partial<TRow>): void {
        const next = value.slice();
        next[idx] = { ...next[idx], ...patch };
        onChange(next);
    }
    function remove(idx: number): void {
        onChange(value.filter((_, i) => i !== idx));
    }
    function add(): void {
        if (maxRows !== undefined && value.length >= maxRows) return;
        onChange([...value, newRow()]);
    }

    return (
        <div className="space-y-2">
            <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted">
                        <tr>
                            {fields.map((f) => (
                                <th
                                    key={f.name}
                                    className={`px-2 py-1 text-left font-medium text-muted-foreground ${f.widthClass ?? ''}`}
                                >
                                    {f.label}
                                </th>
                            ))}
                            <th className="w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {value.length === 0 && (
                            <tr>
                                <td colSpan={fields.length + 1} className="px-2 py-3 text-center text-muted-foreground">
                                    No rows yet
                                </td>
                            </tr>
                        )}
                        {value.map((row, idx) => (
                            <tr key={idx} className="border-t border-border">
                                {fields.map((f) => (
                                    <td key={f.name} className="px-2 py-1">
                                        {f.render
                                            ? f.render(row, (patch) => update(idx, patch))
                                            : (
                                                <Input
                                                    type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                                                    placeholder={f.placeholder}
                                                    disabled={disabled}
                                                    value={(row[f.name] as string | number | null | undefined) ?? ''}
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        const parsed = f.kind === 'number'
                                                            ? (raw === '' ? null : Number(raw))
                                                            : raw;
                                                        update(idx, { [f.name]: parsed } as unknown as Partial<TRow>);
                                                    }}
                                                />
                                            )}
                                    </td>
                                ))}
                                <td className="px-1 py-1 text-right">
                                    {!disabled && (
                                        <IconButton
                                            icon={Trash2}
                                            tooltip="Remove row"
                                            variant="danger"
                                            onClick={() => remove(idx)}
                                        />
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!disabled && (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={add}
                    disabled={maxRows !== undefined && value.length >= maxRows}
                >
                    <Plus size={14} />
                    {addLabel}
                </Button>
            )}
        </div>
    );
}

'use client';

import { RepeaterTable, type RepeaterField } from '@/components/shared/RepeaterTable';
import type { DoItem } from '@/lib/admin-log-types';

/**
 * Item list editor for Delivery Order. Backend validator
 * `itemListEntry` accepts item_name + description + qty + unit — no
 * prices (DO is a delivery doc, not a quotation).
 */
export function DoItemListEditor({
    value, onChange, disabled,
}: {
    value: DoItem[];
    onChange: (rows: DoItem[]) => void;
    disabled?: boolean;
}) {
    return (
        <RepeaterTable<DoItem>
            fields={fields}
            value={value}
            onChange={onChange}
            newRow={() => ({ item_name: '', description: '', qty: 1, unit: 'ea' })}
            disabled={disabled}
            addLabel="Add item"
        />
    );
}

const fields: RepeaterField<DoItem>[] = [
    { name: 'item_name',   label: 'Item',        kind: 'text',   widthClass: 'w-48' },
    { name: 'description', label: 'Description', kind: 'text' },
    { name: 'qty',         label: 'Qty',         kind: 'number', widthClass: 'w-20' },
    { name: 'unit',        label: 'Unit',        kind: 'text',   widthClass: 'w-16' },
];

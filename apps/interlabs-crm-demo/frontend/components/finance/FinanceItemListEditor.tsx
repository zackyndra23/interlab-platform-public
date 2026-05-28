'use client';

import { RepeaterTable, type RepeaterField } from '@/components/shared/RepeaterTable';
import type { FinanceItem } from '@/lib/finance-types';

/**
 * Shared line-item editor for Finance forms. Backend `itemListEntry`
 * accepts `unit_price`, `subtotal_per_item`, and `total_price`
 * interchangeably (via `unknown(true)`), so we standardise on
 * `total_price` to match the Sales module's pattern. The caller is
 * responsible for recomputing `total_price = qty * unit_price` at
 * submit time.
 */
export function FinanceItemListEditor({
    value, onChange, disabled,
}: {
    value: FinanceItem[];
    onChange: (rows: FinanceItem[]) => void;
    disabled?: boolean;
}) {
    return (
        <RepeaterTable<FinanceItem>
            fields={fields}
            value={value}
            onChange={onChange}
            newRow={() => ({
                item_name: '', description: '', qty: 1, unit: 'ea',
                unit_price: 0, total_price: 0,
            })}
            disabled={disabled}
            addLabel="Add item"
        />
    );
}

const fields: RepeaterField<FinanceItem>[] = [
    { name: 'item_name',   label: 'Item',         kind: 'text',   widthClass: 'w-48' },
    { name: 'description', label: 'Description',  kind: 'text' },
    { name: 'qty',         label: 'Qty',          kind: 'number', widthClass: 'w-20' },
    { name: 'unit',        label: 'Unit',         kind: 'text',   widthClass: 'w-16' },
    { name: 'unit_price',  label: 'Unit Price',   kind: 'number', widthClass: 'w-28' },
    { name: 'total_price', label: 'Total',        kind: 'number', widthClass: 'w-28' },
];

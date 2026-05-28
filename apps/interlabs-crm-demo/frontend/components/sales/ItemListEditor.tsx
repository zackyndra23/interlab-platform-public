'use client';

import { RepeaterTable, type RepeaterField } from '@/components/shared/RepeaterTable';

/**
 * Thin wrapper over RepeaterTable pre-configured for the item shapes
 * Sales forms use. Three flavours are exposed so each form can pick the
 * column set the MOD_sales spec calls for:
 *
 *   - basic     : item_name, description, qty, unit, unit_price, total_price
 *                 (Quotation, SalesPO, PurchaseRequest)
 *   - hpp       : item_name, qty, unit, cost_price, selling_price,
 *                 margin_amount, margin_percent  (HPP)
 *
 * Auto-computation (total_price = qty × unit_price, margin = selling-cost)
 * is handled via a small effect in the caller; keeping it out of the
 * repeater keeps this component reusable across forms with different
 * calculation rules.
 */

export type LineKind = 'basic' | 'hpp';

export type BasicItem = {
    item_name: string;
    description?: string | null;
    qty: number;
    unit: string;
    unit_price: number;
    total_price: number;
};

export type HppLineItem = {
    item_name: string;
    qty: number;
    unit: string;
    cost_price: number;
    selling_price: number;
    margin_amount: number;
    margin_percent: number;
};

export function ItemListEditor<T extends BasicItem | HppLineItem>({
    kind, value, onChange, disabled,
}: {
    kind: LineKind;
    value: T[];
    onChange: (rows: T[]) => void;
    disabled?: boolean;
}) {
    const fields: RepeaterField<T>[] = kind === 'basic'
        ? (basicFields as RepeaterField<T>[])
        : (hppFields as RepeaterField<T>[]);

    const newRow = kind === 'basic'
        ? (() => ({
            item_name: '', description: '', qty: 1, unit: 'ea',
            unit_price: 0, total_price: 0,
        }) as T)
        : (() => ({
            item_name: '', qty: 1, unit: 'ea',
            cost_price: 0, selling_price: 0,
            margin_amount: 0, margin_percent: 0,
        }) as T);

    return (
        <RepeaterTable<T>
            fields={fields}
            value={value}
            onChange={onChange}
            newRow={newRow}
            disabled={disabled}
            addLabel="Add item"
        />
    );
}

const basicFields: RepeaterField<BasicItem>[] = [
    { name: 'item_name',   label: 'Item',         kind: 'text',   widthClass: 'w-48' },
    { name: 'description', label: 'Description',  kind: 'text' },
    { name: 'qty',         label: 'Qty',          kind: 'number', widthClass: 'w-20' },
    { name: 'unit',        label: 'Unit',         kind: 'text',   widthClass: 'w-16' },
    { name: 'unit_price',  label: 'Unit Price',   kind: 'number', widthClass: 'w-28' },
    { name: 'total_price', label: 'Total',        kind: 'number', widthClass: 'w-28' },
];

const hppFields: RepeaterField<HppLineItem>[] = [
    { name: 'item_name',      label: 'Item',           kind: 'text',   widthClass: 'w-48' },
    { name: 'qty',            label: 'Qty',            kind: 'number', widthClass: 'w-20' },
    { name: 'unit',           label: 'Unit',           kind: 'text',   widthClass: 'w-16' },
    { name: 'cost_price',     label: 'Cost',           kind: 'number', widthClass: 'w-28' },
    { name: 'selling_price',  label: 'Selling',        kind: 'number', widthClass: 'w-28' },
    { name: 'margin_amount',  label: 'Margin',         kind: 'number', widthClass: 'w-28' },
    { name: 'margin_percent', label: 'Margin %',       kind: 'number', widthClass: 'w-20' },
];

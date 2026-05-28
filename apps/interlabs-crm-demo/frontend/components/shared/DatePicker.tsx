'use client';

import * as React from 'react';

import { Input } from '@/components/ui/Input';

/**
 * Thin wrapper around the native <input type="date">. Good enough for
 * Indonesian-locale single-date fields without pulling in a calendar
 * library. Value is always ISO-8601 (yyyy-mm-dd) so it maps 1:1 onto the
 * backend's DATE columns.
 */
export function DatePicker({
    value, onChange, id, disabled, min, max,
}: {
    value: string | null | undefined;
    onChange: (v: string | null) => void;
    id?: string;
    disabled?: boolean;
    min?: string;
    max?: string;
}) {
    return (
        <Input
            id={id}
            type="date"
            value={value ?? ''}
            disabled={disabled}
            min={min}
            max={max}
            onChange={(e) => onChange(e.target.value || null)}
        />
    );
}

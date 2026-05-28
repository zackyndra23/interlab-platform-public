'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/Label';

export type FormFieldProps = {
    label?: string;
    name: string;
    required?: boolean;
    error?: string | null;
    hint?: string;
    children: React.ReactNode;
    className?: string;
};

/**
 * Wraps any input with a label, optional hint, and inline error message.
 * Designed to be framework-agnostic — pairs with react-hook-form by
 * accepting the error string the caller resolves from `formState.errors`.
 */
export function FormField({
    label, name, required, error, hint, children, className,
}: FormFieldProps) {
    return (
        <div className={cn('space-y-1', className)}>
            {label && (
                <Label htmlFor={name}>
                    {label}
                    {required && <span className="ml-0.5 text-destructive">*</span>}
                </Label>
            )}
            {children}
            {hint && !error && (
                <p className="text-xs text-muted-foreground">{hint}</p>
            )}
            {error && (
                <p className="text-xs text-destructive">{error}</p>
            )}
        </div>
    );
}

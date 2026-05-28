'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'danger';

const variantClass: Record<Variant, string> = {
    primary: 'text-primary hover:bg-accent',
    ghost: 'text-muted-foreground hover:bg-accent',
    danger: 'text-destructive hover:bg-destructive/10',
};

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    icon: LucideIcon;
    tooltip: string;
    variant?: Variant;
    iconSize?: number;
};

/**
 * Icon-only action button per IMPL_frontend §F9 universal rule. Tooltip
 * shown via the native `title` attribute — swap for shadcn Tooltip later.
 * Never renders a text label beside the icon.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({
        icon: Icon, tooltip, variant = 'ghost', iconSize = 16,
        className, ...props
    }, ref) {
        return (
            <button
                ref={ref}
                type="button"
                title={tooltip}
                aria-label={tooltip}
                className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:pointer-events-none disabled:opacity-40',
                    variantClass[variant],
                    className,
                )}
                {...props}
            >
                <Icon size={iconSize} />
            </button>
        );
    },
);

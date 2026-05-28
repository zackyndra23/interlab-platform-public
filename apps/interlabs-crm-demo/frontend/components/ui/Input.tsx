import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    function Input({ className, ...props }, ref) {
        return (
            <input
                ref={ref}
                className={cn(
                    'flex h-10 w-full rounded',
                    'bg-red-500/10 dark:bg-red-500/20',
                    'text-red-900 dark:text-white',
                    'border border-red-500/30',
                    'px-3 py-2 text-sm',
                    'placeholder:text-red-400 dark:placeholder:text-red-300',
                    'focus:bg-red-500/20 dark:focus:bg-red-500/30',
                    'focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'transition-colors',
                    className,
                )}
                {...props}
            />
        );
    },
);

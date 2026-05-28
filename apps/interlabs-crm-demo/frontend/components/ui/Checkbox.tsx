import * as React from 'react';

import { cn } from '@/lib/utils';

export type CheckboxProps = Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type'
>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    function Checkbox({ className, ...props }, ref) {
        return (
            <input
                ref={ref}
                type="checkbox"
                className={cn(
                    'h-4 w-4 rounded border border-input text-primary',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    className,
                )}
                {...props}
            />
        );
    },
);

'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, children, ...props }, ref) {
    // Auto-style children options for readable dropdown panel.
    const styledChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      if (child.type !== 'option') return child;
      return React.cloneElement(child as React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>, {
        className: cn('bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100', (child.props as React.OptionHTMLAttributes<HTMLOptionElement>).className),
      });
    });
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded',
          'bg-red-500/10 dark:bg-red-500/20',
          'text-red-900 dark:text-white',
          'border border-red-500/30',
          'px-3 py-2 text-sm',
          'focus:bg-red-500/20 dark:focus:bg-red-500/30',
          'focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors',
          className,
        )}
        {...props}
      >
        {styledChildren}
      </select>
    );
  },
);

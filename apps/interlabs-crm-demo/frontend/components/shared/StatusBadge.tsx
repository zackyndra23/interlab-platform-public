import { cn } from '@/lib/utils';

type Variant =
    | 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Maps arbitrary status strings to a handful of visual variants. Modules
 * provide their own status → variant mapping via the `variant` prop; this
 * component doesn't know about business semantics so new statuses don't
 * need a rebuild here.
 */
export function StatusBadge({
    status,
    variant = 'neutral',
    className,
}: {
    status: string;
    variant?: Variant;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                variantMap[variant],
                className,
            )}
        >
            {status}
        </span>
    );
}

const variantMap: Record<Variant, string> = {
    neutral: 'bg-slate-500/20 text-slate-700 dark:text-slate-200 border border-slate-500/40',
    info:    'bg-blue-500/20 text-blue-700 dark:text-blue-200 border border-blue-500/40',
    success: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 border border-emerald-500/40',
    warning: 'bg-amber-500/20 text-amber-700 dark:text-amber-200 border border-amber-500/40',
    danger:  'bg-red-500/20 text-red-700 dark:text-red-200 border border-red-500/40',
    muted:   'bg-zinc-500/20 text-zinc-700 dark:text-zinc-200 border border-zinc-500/40',
};

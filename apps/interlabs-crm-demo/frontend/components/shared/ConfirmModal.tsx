'use client';

import { useEffect } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export type ConfirmModalProps = {
    isOpen: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
};

/**
 * Standard confirmation dialog. Pure-CSS backdrop + centred card. Escape
 * key cancels; click on the backdrop cancels.
 */
export function ConfirmModal({
    isOpen, title, message,
    confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    variant = 'default',
    onConfirm, onCancel,
}: ConfirmModalProps) {
    useEffect(() => {
        if (!isOpen) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
                aria-hidden
                onClick={onCancel}
                className="absolute inset-0 bg-black/40"
            />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'relative z-10 w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg',
                )}
            >
                {title && <h3 className="mb-2 text-base font-semibold">{title}</h3>}
                <p className="text-sm text-muted-foreground">{message}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={variant === 'danger' ? 'danger' : 'primary'}
                        size="sm"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}

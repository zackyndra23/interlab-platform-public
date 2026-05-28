'use client';

import { Save, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';

/**
 * Bottom-of-form action bar.
 *
 *   - Cancel: navigate away (parent supplies the handler).
 *   - Save Draft: calls onSaveDraft with current values (no validation).
 *   - Submit: runs the submit handler (validation + API).
 *
 * Keeping Save-Draft distinct from Submit honours F9's "Save as Draft
 * button distinct from Submit button" rule.
 */
export function FormActions({
    onCancel, onSaveDraft, onSubmit,
    submitLabel = 'Submit',
    submitting = false,
    showSaveDraft = true,
}: {
    onCancel: () => void;
    onSaveDraft?: () => void;
    onSubmit?: () => void;
    submitLabel?: string;
    submitting?: boolean;
    showSaveDraft?: boolean;
}) {
    return (
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={submitting}
            >
                <X size={14} />
                Cancel
            </Button>
            {showSaveDraft && onSaveDraft && (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onSaveDraft}
                    disabled={submitting}
                >
                    <Save size={14} />
                    Save Draft
                </Button>
            )}
            <Button
                type={onSubmit ? 'button' : 'submit'}
                size="sm"
                onClick={onSubmit}
                disabled={submitting}
            >
                <Send size={14} />
                {submitting ? 'Saving…' : submitLabel}
            </Button>
        </div>
    );
}

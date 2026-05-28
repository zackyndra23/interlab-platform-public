'use client';
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { profileApi } from '@/lib/profile-api';
import { isPasswordStrong, validatePasswordStrength, PASSWORD_CHECKS } from '@/lib/password-strength';

/**
 * Change Password section for /profile/edit page (Stage 4 of auth-features spec).
 *
 * Three fields: current → new → repeat. Realtime checklist shows strength
 * rules being met (green check) or unmet (red X) as user types in the
 * "new password" field. Submit blocked until all rules pass + repeat matches.
 *
 * Backend POST /api/auth/change-password verifies current password (argon2id
 * or legacy bcrypt), enforces strength rules server-side too, then hashes
 * new with argon2id.
 */
export function ChangePasswordSection() {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [repeatPw, setRepeatPw] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const newPwErrors = validatePasswordStrength(newPw);
    const newPwStrong = newPw.length > 0 && newPwErrors.length === 0;
    const repeatMatches = repeatPw.length > 0 && newPw === repeatPw;
    const canSubmit
        = currentPw.length > 0
        && newPwStrong
        && repeatMatches
        && !submitting;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!isPasswordStrong(newPw)) {
            toast.error(validatePasswordStrength(newPw)[0] ?? 'Password is too weak');
            return;
        }
        if (newPw !== repeatPw) {
            toast.error('New password and repeat do not match');
            return;
        }
        setSubmitting(true);
        try {
            await profileApi.changePassword({
                current_password: currentPw,
                new_password: newPw,
            });
            toast.success('Password changed successfully');
            setCurrentPw('');
            setNewPw('');
            setRepeatPw('');
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Change failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="mb-8 border-t border-gray-200 dark:border-gray-700 pt-6">
            <h2 className="text-lg font-semibold mb-1">Change your password</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                You will stay logged in on this device after changing your password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
                <label className="block">
                    <span className="text-sm">
                        Old password <span className="text-red-500">*</span>
                    </span>
                    <Input
                        type="password"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        autoComplete="current-password"
                        required
                    />
                </label>

                <label className="block">
                    <span className="text-sm">
                        New password <span className="text-red-500">*</span>
                    </span>
                    <Input
                        type="password"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        autoComplete="new-password"
                        required
                    />
                    {/* Realtime strength checklist */}
                    {newPw.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs">
                            {PASSWORD_CHECKS.map(({ label, test }) => {
                                const met = test(newPw);
                                return (
                                    <li
                                        key={label}
                                        className={`flex items-center gap-1.5 ${
                                            met
                                                ? 'text-green-600 dark:text-green-400'
                                                : 'text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                        {met ? <Check size={12} /> : <X size={12} />}
                                        {label}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </label>

                <label className="block">
                    <span className="text-sm">
                        Repeat new password <span className="text-red-500">*</span>
                    </span>
                    <Input
                        type="password"
                        value={repeatPw}
                        onChange={(e) => setRepeatPw(e.target.value)}
                        autoComplete="new-password"
                        required
                    />
                    {repeatPw.length > 0 && !repeatMatches && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                            Passwords do not match
                        </p>
                    )}
                </label>

                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? 'Saving...' : 'Save'}
                </Button>
            </form>
        </section>
    );
}

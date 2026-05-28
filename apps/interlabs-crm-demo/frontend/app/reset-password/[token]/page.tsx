'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { PASSWORD_CHECKS } from '@/lib/password-strength';

export default function ResetPasswordPage() {
    const params = useParams<{ token: string }>();
    const token = typeof params?.token === 'string' ? params.token : '';
    const router = useRouter();

    const [newPw, setNewPw] = useState('');
    const [repeatPw, setRepeatPw] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const allChecksMet = PASSWORD_CHECKS.every((c) => c.test(newPw));
    const repeatMatches = repeatPw.length > 0 && newPw === repeatPw;
    const canSubmit = allChecksMet && repeatMatches && !submitting && token.length === 64;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            await apiPost('/api/auth/reset-password', { token, new_password: newPw });
            toast.success('Password reset successfully. Please sign in with your new password.');
            router.replace('/login');
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Reset failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
        } finally {
            setSubmitting(false);
        }
    }

    if (!token || token.length !== 64) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-6">
                <div className="max-w-md w-full bg-card border rounded-lg p-8 space-y-4">
                    <h1 className="text-2xl font-semibold">Invalid reset link</h1>
                    <p className="text-sm text-muted-foreground">
                        The link is malformed. Please request a new password reset.
                    </p>
                    <Link href="/forgot-password" className="text-sm text-red-600 dark:text-red-400 hover:underline">
                        Request a new link
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <form onSubmit={handleSubmit} className="max-w-md w-full bg-card border rounded-lg p-8 space-y-4">
                <h1 className="text-2xl font-semibold">Choose a new password</h1>
                <p className="text-sm text-muted-foreground">
                    Pick something secure. After saving you&apos;ll need to sign in again on all your devices.
                </p>
                <label className="block">
                    <span className="text-sm">New password <span className="text-red-500">*</span></span>
                    <Input type="password" autoComplete="new-password" required value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                    {newPw.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs">
                            {PASSWORD_CHECKS.map(({ label, test }) => {
                                const met = test(newPw);
                                return (
                                    <li key={label} className={`flex items-center gap-1.5 ${met ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                        {met ? <Check size={12} /> : <X size={12} />}
                                        {label}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </label>
                <label className="block">
                    <span className="text-sm">Repeat new password <span className="text-red-500">*</span></span>
                    <Input type="password" autoComplete="new-password" required value={repeatPw} onChange={(e) => setRepeatPw(e.target.value)} />
                    {repeatPw.length > 0 && !repeatMatches && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">Passwords do not match</p>
                    )}
                </label>
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? 'Saving...' : 'Reset password'}
                </Button>
            </form>
        </div>
    );
}

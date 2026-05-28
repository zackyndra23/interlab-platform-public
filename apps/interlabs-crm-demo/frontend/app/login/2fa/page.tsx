'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { twofactorApi } from '@/lib/twofactor-api';
import { setTokens } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// ---------------------------------------------------------------------------
// Inner form — must be wrapped in <Suspense> because useSearchParams
// suspends during SSR / the first render before hydration.
// ---------------------------------------------------------------------------

function TwoFactorChallengeForm() {
    const router = useRouter();
    const params = useSearchParams();
    const setUser = useAuthStore((s) => s.setUser);

    const pending_token = params?.get('pending_token') ?? '';
    const method = (params?.get('method') ?? 'totp') as 'email' | 'totp';

    const [code, setCode] = useState('');
    const [useBackup, setUseBackup] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!code || !pending_token) return;
        setSubmitting(true);
        try {
            const data = await twofactorApi.loginVerify({ pending_token, code });
            setTokens({
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                rememberMe: data.remember_me ?? false,
            });
            setUser(data.user);
            toast.success(`Welcome back, ${data.user.display_name}`);
            router.replace('/dashboard');
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } }; message?: string };
            toast.error(e?.response?.data?.error ?? 'Verification failed');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleResend() {
        setResending(true);
        try {
            await twofactorApi.resendEmail({ pending_token });
            toast.success('New code sent to your email');
        } catch (err: unknown) {
            const e = err as { message?: string };
            toast.error(`Resend failed: ${e?.message ?? 'unknown'}`);
        } finally {
            setResending(false);
        }
    }

    function toggleBackup() {
        setUseBackup((v) => !v);
        setCode('');
    }

    // No pending_token means user navigated here directly — redirect to login.
    if (!pending_token) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-card border rounded-lg p-8">
                    <p className="text-sm text-muted-foreground">
                        Invalid 2FA session. Please{' '}
                        <a href="/login" className="text-red-600 dark:text-red-400 underline">
                            sign in again
                        </a>
                        .
                    </p>
                </div>
            </div>
        );
    }

    const placeholder = useBackup
        ? 'Backup code (10 characters)'
        : method === 'email'
          ? '6-digit email code'
          : '6-digit authenticator code';

    const hint =
        method === 'email'
            ? 'Enter the 6-digit code we sent to your email.'
            : useBackup
              ? 'Enter one of your 10-character backup codes.'
              : 'Enter the 6-digit code from your authenticator app.';

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <form
                onSubmit={handleSubmit}
                className="max-w-md w-full bg-card border rounded-xl p-8 shadow-lg space-y-5"
            >
                {/* Header */}
                <div className="text-center space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Two-factor authentication
                    </h1>
                    <p className="text-sm text-muted-foreground">{hint}</p>
                </div>

                {/* Code input */}
                <Input
                    type="text"
                    inputMode={useBackup ? 'text' : 'numeric'}
                    autoFocus
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.trim())}
                    placeholder={placeholder}
                    required
                    className="text-center text-lg tracking-widest"
                />

                {/* Submit */}
                <Button
                    type="submit"
                    disabled={submitting || !code}
                    className="w-full"
                >
                    {submitting ? 'Verifying...' : 'Verify'}
                </Button>

                {/* Secondary actions */}
                <div className="flex items-center justify-center text-sm">
                    {method === 'email' ? (
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={resending}
                            className="text-red-600 dark:text-red-400 hover:underline underline-offset-4 disabled:opacity-50"
                        >
                            {resending ? 'Sending...' : 'Resend code'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={toggleBackup}
                            className="text-red-600 dark:text-red-400 hover:underline underline-offset-4"
                        >
                            {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
                        </button>
                    )}
                </div>

                {/* Back to login */}
                <p className="text-center text-xs text-muted-foreground">
                    <a href="/login" className="hover:underline underline-offset-4">
                        Back to sign in
                    </a>
                </p>
            </form>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Page export — Suspense boundary required by Next.js App Router when the
// component uses useSearchParams().
// ---------------------------------------------------------------------------

export default function TwoFactorPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6">Loading...</div>}>
            <TwoFactorChallengeForm />
        </Suspense>
    );
}

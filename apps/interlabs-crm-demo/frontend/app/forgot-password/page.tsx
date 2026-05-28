'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { apiPost } from '@/lib/api';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!email.trim()) return;
        setSubmitting(true);
        try {
            await apiPost('/api/auth/forgot-password', { email: email.trim() });
            setSubmitted(true);
        } catch (err: unknown) {
            const e = err as { message?: string };
            toast.error(`Request failed: ${e?.message ?? 'unknown'}`);
        } finally {
            setSubmitting(false);
        }
    }

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-6">
                <div className="max-w-md w-full bg-card border rounded-lg p-8 space-y-4">
                    <h1 className="text-2xl font-semibold">Check your email</h1>
                    <p className="text-sm text-muted-foreground">
                        If an account exists for <span className="font-medium">{email}</span>, we&apos;ve sent a password reset link.
                        It expires in 30 minutes.
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Don&apos;t see it? Check your spam folder.
                    </p>
                    <Link href="/login" className="text-sm text-red-600 dark:text-red-400 hover:underline">
                        ← Back to sign in
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <form onSubmit={handleSubmit} className="max-w-md w-full bg-card border rounded-lg p-8 space-y-4">
                <h1 className="text-2xl font-semibold">Reset your password</h1>
                <p className="text-sm text-muted-foreground">
                    Enter the email address associated with your account, and we&apos;ll send you a link to reset your password.
                </p>
                <label className="block">
                    <span className="text-sm">Email</span>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                </label>
                <div className="flex items-center justify-between gap-3">
                    <Link href="/login" className="text-sm text-red-600 dark:text-red-400 hover:underline">
                        ← Back to sign in
                    </Link>
                    <Button type="submit" disabled={submitting || !email.trim()}>
                        {submitting ? 'Sending...' : 'Send reset link'}
                    </Button>
                </div>
            </form>
        </div>
    );
}

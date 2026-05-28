'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { setTokens } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';

export default function ActivatePage() {
    const params = useParams<{ token: string }>();
    const router = useRouter();
    const token = typeof params?.token === 'string' ? params.token : '';
    const [displayName, setDisplayName] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword !== confirm) {
            toast.error('Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            toast.error('Password must be at least 8 characters');
            return;
        }
        setSubmitting(true);
        try {
            const r = await invitationApi.activate({ token, newPassword, displayName });
            // Persist tokens just like login — use rememberMe=false for activation sessions.
            setTokens({
                accessToken: r.access_token,
                refreshToken: r.refresh_token,
                rememberMe: false,
            });
            // Hydrate the auth store so AppShell sees the user immediately.
            useAuthStore.getState().setUser(r.user);
            toast.success('Account activated! Welcome to Interlab.');
            router.replace('/');
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Activation failed: ${err?.response?.data?.error ?? err?.message}`);
        } finally {
            setSubmitting(false);
        }
    }

    if (!token) {
        return (
            <div className="p-6">
                Missing token. Use the link from your invitation email.
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <form
                onSubmit={(e) => void handleSubmit(e)}
                className="bg-white p-8 rounded shadow w-full max-w-md space-y-4"
            >
                <h1 className="text-2xl font-semibold">Activate your account</h1>
                <p className="text-sm text-gray-600">
                    Welcome to Interlab. Set your display name and a new password.
                </p>
                <label className="block">
                    <span className="text-sm">Display name</span>
                    <input
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="border p-2 w-full rounded"
                    />
                </label>
                <label className="block">
                    <span className="text-sm">New password (min 8 chars)</span>
                    <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="border p-2 w-full rounded"
                    />
                </label>
                <label className="block">
                    <span className="text-sm">Confirm password</span>
                    <input
                        type="password"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className="border p-2 w-full rounded"
                    />
                </label>
                <button
                    type="submit"
                    disabled={submitting}
                    className="bg-blue-600 text-white w-full py-2 rounded"
                >
                    {submitting ? 'Activating...' : 'Activate'}
                </button>
            </form>
        </div>
    );
}

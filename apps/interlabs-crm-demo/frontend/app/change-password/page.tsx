'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { apiGet } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import type { UserProfile } from '@/lib/rbac';
import { toast } from 'sonner';

export default function ChangePasswordPage() {
    const router = useRouter();
    const [currentPassword, setCurrentPassword] = useState('');
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
            await invitationApi.changePassword({ currentPassword, newPassword });
            // Refresh the user profile so must_change_password flips to false in the store.
            const updated = await apiGet<UserProfile>('/api/auth/me');
            useAuthStore.getState().setUser(updated);
            toast.success('Password changed');
            router.replace('/');
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Change failed: ${err?.response?.data?.error ?? err?.message}`);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <form
                onSubmit={(e) => void handleSubmit(e)}
                className="bg-white p-8 rounded shadow w-full max-w-md space-y-4"
            >
                <h1 className="text-2xl font-semibold">Change password</h1>
                <p className="text-sm text-gray-600">
                    You must change your password before continuing.
                </p>
                <label className="block">
                    <span className="text-sm">Current password</span>
                    <input
                        type="password"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
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
                    <span className="text-sm">Confirm new password</span>
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
                    {submitting ? 'Changing...' : 'Change password'}
                </button>
            </form>
        </div>
    );
}

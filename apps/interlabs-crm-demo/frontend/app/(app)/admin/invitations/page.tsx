'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { invitationApi } from '@/lib/invitation-api';
import type { Invitation, InvitationStatus, CreateInvitationResult } from '@/lib/invitation-types';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/invitation-ui';
import { ROLE_LABELS } from '@/lib/admin-permissions-ui';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import { isGlobalRole } from '@/lib/rbac';
import { profileApi } from '@/lib/profile-api';
import type { TwoFactorMethod } from '@/lib/twofactor-types';

const STATUSES: InvitationStatus[] = ['pending', 'accepted', 'expired', 'revoked'];

export default function InvitationsPage() {
    const user = useAuthStore((s) => s.user);
    const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>('disabled');
    const [items, setItems] = useState<Invitation[]>([]);
    const [filter, setFilter] = useState<InvitationStatus | ''>('');
    const [loading, setLoading] = useState(true);
    const [resendResult, setResendResult] = useState<(CreateInvitationResult & { email: string }) | null>(null);

    async function refresh() {
        setLoading(true);
        try {
            setItems(await invitationApi.list(filter || undefined));
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Load failed: ${err?.response?.data?.error ?? err?.message}`);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        profileApi.getMyProfile().then((p) => setTwoFactorMethod(p.two_factor_method ?? 'disabled')).catch(() => {});
    }, []);

    useEffect(() => {
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]);

    const inviteBlocked = isGlobalRole(user?.role) && twoFactorMethod === 'disabled';

    async function handleRevoke(inv: Invitation) {
        const reason = prompt(`Revoke invitation for ${inv.email}? Reason:`, '');
        if (reason === null) return;
        try {
            await invitationApi.revoke(inv.id, reason);
            toast.success('Revoked');
            void refresh();
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Revoke failed: ${err?.response?.data?.error ?? err?.message}`);
        }
    }

    async function handleResend(inv: Invitation) {
        if (!confirm(`Resend invitation for ${inv.email}? The old token will be invalidated.`)) return;
        try {
            const r = await invitationApi.resend(inv.id);
            toast.success('Resent — new credentials issued');
            setResendResult({ ...r, email: inv.email });
            void refresh();
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Resend failed: ${err?.response?.data?.error ?? err?.message}`);
        }
    }

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text).then(() => {
            toast.success('Copied to clipboard');
        }).catch(() => {
            toast.error('Copy failed — please select and copy manually');
        });
    }

    const activationUrl = resendResult
        ? `${window.location.origin}/activate/${resendResult.activationToken}`
        : '';

    return (
        <div className="p-6 max-w-6xl">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-semibold">Invitations</h1>
                {inviteBlocked ? (
                    <span
                        role="button"
                        aria-disabled="true"
                        tabIndex={0}
                        title="Aktifkan 2FA di Settings → Security sebelum mengundang user."
                        className="bg-gray-300 text-gray-600 px-3 py-1 rounded cursor-not-allowed"
                    >
                        + Undang user (aktifkan 2FA dulu)
                    </span>
                ) : (
                    <Link
                        href="/admin/invitations/new"
                        className="bg-blue-600 text-white px-3 py-1 rounded"
                    >
                        + New invitation
                    </Link>
                )}
            </div>

            {/* Resend credentials card */}
            {resendResult && (
                <div className="mb-6 rounded-lg border border-yellow-400 bg-yellow-50 p-4 text-sm">
                    <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-yellow-800">
                            ⚠ Copy these credentials now — they will not be shown again
                        </p>
                        <button
                            onClick={() => setResendResult(null)}
                            className="text-yellow-700 hover:text-yellow-900 text-xs underline"
                        >
                            Done
                        </button>
                    </div>
                    <p className="text-yellow-700 mb-3">
                        New credentials issued for <strong>{resendResult.email}</strong>
                    </p>
                    <div className="space-y-2">
                        <div>
                            <label className="block text-xs font-medium text-yellow-700 mb-1">
                                Activation URL
                            </label>
                            <div className="flex items-center gap-2">
                                <code className="block flex-1 rounded bg-yellow-100 border border-yellow-300 px-2 py-1 text-xs break-all">
                                    {activationUrl}
                                </code>
                                <button
                                    onClick={() => copyToClipboard(activationUrl)}
                                    className="shrink-0 rounded bg-yellow-200 hover:bg-yellow-300 px-2 py-1 text-xs text-yellow-900"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-yellow-700 mb-1">
                                Initial Password
                            </label>
                            <div className="flex items-center gap-2">
                                <code className="block flex-1 rounded bg-yellow-100 border border-yellow-300 px-2 py-1 text-xs">
                                    {resendResult.initialPassword}
                                </code>
                                <button
                                    onClick={() => copyToClipboard(resendResult.initialPassword)}
                                    className="shrink-0 rounded bg-yellow-200 hover:bg-yellow-300 px-2 py-1 text-xs text-yellow-900"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-yellow-700 mb-1">
                                Expires At
                            </label>
                            <code className="block rounded bg-yellow-100 border border-yellow-300 px-2 py-1 text-xs">
                                {new Date(resendResult.expiresAt).toLocaleString()}
                            </code>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setFilter('')}
                    className={`px-3 py-1 rounded transition-colors ${
                        !filter
                            ? 'bg-red-600 text-white border border-red-600'
                            : 'bg-red-500/10 dark:bg-red-500/20 text-red-700 dark:text-red-200 border border-red-500/30 hover:bg-red-500/20 dark:hover:bg-red-500/30'
                    }`}
                >
                    All
                </button>
                {STATUSES.map((s) => (
                    <button
                        key={s}
                        onClick={() => setFilter(s)}
                        className={`px-3 py-1 rounded transition-colors ${
                            filter === s
                                ? 'bg-red-600 text-white border border-red-600'
                                : 'bg-red-500/10 dark:bg-red-500/20 text-red-700 dark:text-red-200 border border-red-500/30 hover:bg-red-500/20 dark:hover:bg-red-500/30'
                        }`}
                    >
                        {STATUS_LABELS[s]}
                    </button>
                ))}
            </div>
            {loading ? (
                <div>Loading...</div>
            ) : (
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr>
                            <th className="border p-2 text-left">Email</th>
                            <th className="border p-2 text-left">Role</th>
                            <th className="border p-2 text-left">Status</th>
                            <th className="border p-2 text-left">Expires</th>
                            <th className="border p-2 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="border p-3 text-center text-gray-500">
                                    No invitations
                                </td>
                            </tr>
                        ) : (
                            items.map((inv) => (
                                <tr key={inv.id}>
                                    <td className="border p-2">{inv.email}</td>
                                    <td className="border p-2">
                                        {ROLE_LABELS[inv.role_key as keyof typeof ROLE_LABELS] ??
                                            inv.role_key}
                                    </td>
                                    <td className="border p-2">
                                        <span className={STATUS_COLORS[inv.status]}>
                                            {STATUS_LABELS[inv.status]}
                                        </span>
                                    </td>
                                    <td className="border p-2 text-xs">
                                        {new Date(inv.expires_at).toLocaleString()}
                                    </td>
                                    <td className="border p-2 space-x-2">
                                        {inv.status === 'pending' && (
                                            <>
                                                <button
                                                    onClick={() => void handleResend(inv)}
                                                    className="text-blue-600 hover:underline"
                                                >
                                                    Resend
                                                </button>
                                                <button
                                                    onClick={() => void handleRevoke(inv)}
                                                    className="text-red-600 hover:underline"
                                                >
                                                    Revoke
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            )}
        </div>
    );
}

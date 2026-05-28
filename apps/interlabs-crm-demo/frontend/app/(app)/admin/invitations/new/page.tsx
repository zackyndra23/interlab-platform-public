'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import { ROLE_LABELS } from '@/lib/admin-permissions-ui';
import type { RoleLevel } from '@/lib/admin-permissions-types';
import type { CreateInvitationResult } from '@/lib/invitation-types';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/auth.store';
import { isGlobalRole } from '@/lib/rbac';
import { profileApi } from '@/lib/profile-api';
import type { TwoFactorMethod } from '@/lib/twofactor-types';

const INVITABLE_ROLES = [
    'sales',
    'admin_log',
    'finance',
    'technical',
    'hrga',
    'tax_insurance',
] as const;

export default function NewInvitationPage() {
    const router = useRouter();
    const user = useAuthStore((s) => s.user);
    const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>('disabled');
    const [email, setEmail] = useState('');
    const [roleKey, setRoleKey] = useState<string>('sales');
    const [levelId, setLevelId] = useState<string>('');
    const [levels, setLevels] = useState<RoleLevel[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<CreateInvitationResult | null>(null);

    useEffect(() => {
        profileApi.getMyProfile().then((p) => setTwoFactorMethod(p.two_factor_method ?? 'disabled')).catch(() => {});
    }, []);

    useEffect(() => {
        adminRbacApi.listLevels(roleKey).then(setLevels).catch(() => setLevels([]));
        setLevelId('');
    }, [roleKey]);

    const inviteBlocked = isGlobalRole(user?.role) && twoFactorMethod === 'disabled';

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        try {
            const r = await invitationApi.create({
                email,
                roleKey,
                levelId: levelId || null,
            });
            setResult(r);
            toast.success('Invitation created');
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Create failed: ${err?.response?.data?.error ?? err?.message}`);
        } finally {
            setSubmitting(false);
        }
    }

    if (inviteBlocked) {
        return (
            <div className="p-6 max-w-md">
                <h1 className="text-2xl font-semibold">New invitation</h1>
                <p className="mt-4 text-sm text-red-600">
                    Aktifkan 2FA di Settings → Security sebelum mengundang user. (Superadmin/CEO wajib 2FA.)
                </p>
            </div>
        );
    }

    if (result) {
        const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/activate/${result.activationToken}`;
        return (
            <div className="p-6 max-w-2xl">
                <h1 className="text-2xl font-semibold mb-4">Invitation created</h1>
                <div className="border p-4 rounded space-y-2 bg-yellow-50">
                    <p className="text-sm font-semibold">
                        Copy these now — they will not be shown again.
                    </p>
                    <div>
                        <b>Email:</b> {email}
                    </div>
                    <div>
                        <b>Activation URL:</b>{' '}
                        <code className="bg-white p-1 break-all">{url}</code>
                    </div>
                    <div>
                        <b>Initial password:</b>{' '}
                        <code className="bg-white p-1">{result.initialPassword}</code>
                    </div>
                    <div>
                        <b>Expires:</b> {new Date(result.expiresAt).toLocaleString()}
                    </div>
                </div>
                <button
                    onClick={() => router.push('/admin/invitations')}
                    className="mt-4 bg-blue-600 text-white px-3 py-1 rounded"
                >
                    Back to list
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 max-w-md space-y-4">
            <h1 className="text-2xl font-semibold">New invitation</h1>
            <label className="block">
                <span className="text-sm">Email</span>
                <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
            </label>
            <label className="block">
                <span className="text-sm">Role</span>
                <Select
                    value={roleKey}
                    onChange={(e) => setRoleKey(e.target.value)}
                >
                    {INVITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                        </option>
                    ))}
                </Select>
            </label>
            <label className="block">
                <span className="text-sm">Level</span>
                <Select
                    value={levelId}
                    onChange={(e) => setLevelId(e.target.value)}
                >
                    <option value="">— assign at activation —</option>
                    {levels.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.level_name}
                        </option>
                    ))}
                </Select>
            </label>
            <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 text-white px-3 py-1 rounded"
            >
                {submitting ? 'Creating...' : 'Create invitation'}
            </button>
        </form>
    );
}

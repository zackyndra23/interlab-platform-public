'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { FormField } from '@/components/shared/FormField';
import { ROLE_LABEL, type RoleKey } from '@/lib/rbac';
import { usersApi } from '@/lib/global-api';
import type {
    AccountStatus, UserCreateInput, UserRow, UserUpdateInput,
} from '@/lib/global-types';

/**
 * Create / edit user modal used by /setup/roles. The same component drives
 * both flows — pass `existing` to enter edit mode (password becomes
 * optional and the role group locks to the existing user's role to mirror
 * the same-role-management constraint).
 *
 * Same-role-management:
 *   - Superadmin/CEO can create users in any role.
 *   - Other managers see only their own role group as a creation target;
 *     the page that mounts this modal enforces that by passing
 *     `roleOptions` accordingly. This component honours whatever it gets.
 */

const ACCOUNT_STATUSES: AccountStatus[] = ['active', 'inactive', 'suspended'];

export function UserFormModal({
    open, existing, roleOptions, onClose, onSaved,
}: {
    open: boolean;
    existing?: UserRow | null;
    roleOptions: RoleKey[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<RoleKey>(roleOptions[0] ?? 'sales');
    const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
    const [canManageSameRole, setCanManageSameRole] = useState(false);

    useEffect(() => {
        if (!open) return;
        if (existing) {
            setEmail(existing.email);
            setDisplayName(existing.display_name);
            setPassword('');
            setRole(existing.role);
            setAccountStatus(existing.account_status);
            setCanManageSameRole(existing.can_manage_same_role);
        } else {
            setEmail('');
            setDisplayName('');
            setPassword('');
            setRole(roleOptions[0] ?? 'sales');
            setAccountStatus('active');
            setCanManageSameRole(false);
        }
    }, [open, existing, roleOptions]);

    if (!open) return null;

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        if (!email.trim() || !displayName.trim()) {
            toast.error('Email and display name are required');
            return;
        }
        if (!existing && password.length < 8) {
            toast.error('Password must be at least 8 characters');
            return;
        }
        setSubmitting(true);
        try {
            if (existing) {
                const payload: UserUpdateInput = {
                    email: email.trim(),
                    display_name: displayName.trim(),
                    role,
                    account_status: accountStatus,
                    can_manage_same_role: canManageSameRole,
                    managed_role_scope: canManageSameRole ? role : null,
                };
                await usersApi.update(existing.id, payload);
                toast.success('User updated');
            } else {
                const payload: UserCreateInput = {
                    email: email.trim(),
                    display_name: displayName.trim(),
                    password,
                    role,
                    account_status: accountStatus,
                    can_manage_same_role: canManageSameRole,
                    managed_role_scope: canManageSameRole ? role : null,
                };
                await usersApi.create(payload);
                toast.success('User created');
            }
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
                aria-hidden
                onClick={onClose}
                className="absolute inset-0 bg-black/40"
            />
            <form
                onSubmit={submit}
                className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-semibold">
                        {existing ? 'Edit user' : 'New user'}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-md p-1 hover:bg-accent"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="space-y-3">
                    <FormField label="Email" name="email" required>
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={submitting}
                        />
                    </FormField>

                    <FormField label="Display name" name="display_name" required>
                        <Input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            disabled={submitting}
                        />
                    </FormField>

                    {!existing && (
                        <FormField label="Initial password" name="password" required
                            hint="At least 8 characters. The user can change it from /settings.">
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={submitting}
                            />
                        </FormField>
                    )}

                    <FormField label="Role" name="role" required>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value as RoleKey)}
                            disabled={submitting || roleOptions.length === 1}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {roleOptions.map((r) => (
                                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                            ))}
                        </select>
                    </FormField>

                    <FormField label="Account status" name="account_status">
                        <select
                            value={accountStatus}
                            onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                            disabled={submitting}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {ACCOUNT_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </FormField>

                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={canManageSameRole}
                            onChange={(e) => setCanManageSameRole(e.target.checked)}
                            disabled={submitting}
                        />
                        Can manage other users in the same role
                    </label>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={submitting}>
                        {submitting ? 'Saving…' : existing ? 'Save' : 'Create'}
                    </Button>
                </div>
            </form>
        </div>
    );
}

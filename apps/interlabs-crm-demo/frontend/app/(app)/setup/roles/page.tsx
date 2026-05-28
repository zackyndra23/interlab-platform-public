'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Mail, Pencil, ShieldPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { NewRoleModal } from '@/components/global/NewRoleModal';
import { UserFormModal } from '@/components/global/UserFormModal';
import { useAuth } from '@/hooks/useAuth';
import {
    isGlobalRole, ROLE_LABEL, type RoleKey,
} from '@/lib/rbac';
import { usersApi } from '@/lib/global-api';
import { formatDate } from '@/lib/utils';
import type { AccountStatus, UserRow } from '@/lib/global-types';

/**
 * /setup/roles per IMPL_frontend §F5.
 *
 * Lists users in a paginated table. Superadmin/CEO see ALL role groups via
 * a role selector; same-role managers see only their own role and can
 * only create users in that role. The "+ New Role" button is reserved for
 * Superadmin/CEO and opens the PermissionMatrix modal.
 */

const ALL_ROLE_KEYS: RoleKey[] = [
    'superadmin', 'ceo', 'sales', 'admin_log', 'finance',
    'technical', 'hrga', 'tax_insurance',
];

function statusVariant(s: AccountStatus): 'success' | 'muted' | 'warning' {
    switch (s) {
        case 'active':    return 'success';
        case 'inactive':  return 'muted';
        case 'suspended': return 'warning';
        default:          return 'muted';
    }
}

export default function SetupRolesPage() {
    const { user } = useAuth();
    const router = useRouter();
    const isAdmin = !!user && isGlobalRole(user.role);

    // Role groups visible to this manager.
    const roleOptions: RoleKey[] = isAdmin
        ? ALL_ROLE_KEYS
        : user
            ? [user.role]
            : [];

    const [activeRole, setActiveRole] = useState<RoleKey | 'all'>(
        isAdmin ? 'all' : (user?.role ?? 'sales'),
    );

    // The role group used when creating a user via the modal — non-admins
    // are pinned to their own role group.
    const creatableRoleOptions: RoleKey[] = isAdmin
        ? ALL_ROLE_KEYS
        : roleOptions;

    const [rows, setRows] = useState<UserRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [loading, setLoading] = useState(true);

    const [showNewRole, setShowNewRole] = useState(false);
    const [editingUser, setEditingUser] = useState<UserRow | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);

    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(h);
    }, [search]);

    const reload = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            const res = await usersApi.list({
                page, limit,
                role: activeRole === 'all' ? undefined : activeRole,
                search: debouncedSearch || undefined,
            });
            setRows(res.rows);
            setTotal(res.meta?.total ?? res.rows.length);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load users');
            setRows([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [page, limit, activeRole, debouncedSearch]);

    useEffect(() => { reload(); }, [reload]);

    const columns = useMemo<ColumnDef<UserRow>[]>(() => [
        { header: 'Email', accessorKey: 'email' },
        { header: 'Name', accessorKey: 'display_name' },
        {
            header: 'Role', accessorKey: 'role',
            cell: ({ getValue }) => ROLE_LABEL[getValue() as RoleKey] ?? String(getValue()),
        },
        {
            header: 'Status', accessorKey: 'account_status',
            cell: ({ getValue }) => {
                const s = getValue() as AccountStatus;
                return <StatusBadge status={s} variant={statusVariant(s)} />;
            },
        },
        {
            header: 'Manage same-role', accessorKey: 'can_manage_same_role',
            cell: ({ getValue }) => (getValue() ? 'Yes' : '—'),
        },
        {
            header: 'Created', accessorKey: 'created_at',
            cell: ({ row }) => formatDate(row.original.created_at),
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton
                            icon={Pencil}
                            tooltip="Edit"
                            onClick={() => setEditingUser(r)}
                        />
                        <IconButton
                            icon={Trash2}
                            tooltip="Delete"
                            variant="danger"
                            disabled={!!user && r.id === user.id}
                            onClick={() => setConfirmDelete(r)}
                        />
                    </div>
                );
            },
        },
    ], [user]);

    async function doDelete(): Promise<void> {
        if (!confirmDelete) return;
        try {
            await usersApi.remove(confirmDelete.id);
            toast.success('User deleted');
            setConfirmDelete(null);
            reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">Setup · Roles &amp; Users</h2>
                    <p className="text-xs text-muted-foreground">
                        {isAdmin
                            ? 'Manage every user across all role groups; create new roles and assign permissions.'
                            : `You can manage other ${ROLE_LABEL[user!.role]} users only. Cross-role changes require Superadmin/CEO.`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {isAdmin && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowNewRole(true)}
                        >
                            <ShieldPlus size={14} />
                            New Role
                        </Button>
                    )}
                    <Button size="sm" onClick={() => router.push('/admin/invitations')}>
                        <Mail size={14} />
                        + Invitation
                    </Button>
                </div>
            </div>

            <DataTable<UserRow>
                columns={columns}
                data={rows}
                loading={loading}
                page={page}
                limit={limit}
                total={total}
                onPageChange={setPage}
                onLimitChange={(l) => { setLimit(l); setPage(1); }}
                searchValue={search}
                onSearch={setSearch}
                searchPlaceholder="Search by email or name…"
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Role group</label>
                        <select
                            value={activeRole}
                            onChange={(e) => {
                                setActiveRole(e.target.value as RoleKey | 'all');
                                setPage(1);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                            disabled={!isAdmin}
                        >
                            {isAdmin && <option value="all">All roles</option>}
                            {roleOptions.map((r) => (
                                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                            ))}
                        </select>
                        {!isAdmin && (
                            <span className="text-muted-foreground">
                                Showing {ROLE_LABEL[user!.role]} only
                            </span>
                        )}
                    </div>
                }
            />

            <NewRoleModal
                open={showNewRole}
                onClose={() => setShowNewRole(false)}
                onCreated={() => { setShowNewRole(false); reload(); }}
            />

            <UserFormModal
                open={creatingUser || !!editingUser}
                existing={editingUser}
                roleOptions={creatableRoleOptions}
                onClose={() => {
                    setCreatingUser(false);
                    setEditingUser(null);
                }}
                onSaved={() => {
                    setCreatingUser(false);
                    setEditingUser(null);
                    reload();
                }}
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete user?"
                message={`Soft-delete ${confirmDelete?.email ?? ''}? They will lose access immediately and any open sessions will be revoked.`}
                variant="danger"
                confirmLabel="Delete"
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import {
    PermissionMatrix,
    type PermissionCapability, type PermissionFeature,
    type PermissionMatrixValue,
} from '@/components/shared/PermissionMatrix';
import { permissionsApi, rolesApi } from '@/lib/global-api';

/**
 * +New Role modal (IMPL_frontend §F5 — Setup → Roles).
 *
 * Two phases inside one modal:
 *   1. Identification — role_key, role_name, description.
 *   2. Permission matrix — feature × capability grid.
 *
 * On submit we (a) POST /api/roles to create the row, (b) PUT
 * /api/roles/:id/permissions with the matrix selections so the role lands
 * with its initial capability set in a single user gesture.
 */
export function NewRoleModal({
    open, onClose, onCreated,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [features, setFeatures] = useState<PermissionFeature[]>([]);
    const [capabilities, setCapabilities] = useState<PermissionCapability[]>([]);
    const [loadingMatrix, setLoadingMatrix] = useState(false);

    const [roleKey, setRoleKey] = useState('');
    const [roleName, setRoleName] = useState('');
    const [description, setDescription] = useState('');
    const [permissions, setPermissions] = useState<PermissionMatrixValue>({});

    useEffect(() => {
        if (!open) return;
        setRoleKey('');
        setRoleName('');
        setDescription('');
        setPermissions({});
        setLoadingMatrix(true);
        Promise.all([
            permissionsApi.listFeatures(),
            permissionsApi.listCapabilities(),
        ])
            .then(([f, c]) => {
                setFeatures(f);
                setCapabilities(c);
            })
            .catch((err) => {
                toast.error(err instanceof Error
                    ? err.message
                    : 'Failed to load permission matrix');
            })
            .finally(() => setLoadingMatrix(false));
    }, [open]);

    // Auto-fill role_key from role_name (kebab-case) until the user
    // touches it manually.
    const [touchedKey, setTouchedKey] = useState(false);
    useEffect(() => {
        if (touchedKey) return;
        setRoleKey(roleName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    }, [roleName, touchedKey]);

    const totalSelected = useMemo(() => {
        return Object.values(permissions).reduce((acc, list) => acc + list.length, 0);
    }, [permissions]);

    if (!open) return null;

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        if (!roleKey.trim() || !roleName.trim()) {
            toast.error('Role key and name are required');
            return;
        }
        setSubmitting(true);
        try {
            const role = await rolesApi.create({
                role_key: roleKey.trim(),
                role_name: roleName.trim(),
                description: description.trim() || undefined,
            });
            if (totalSelected > 0) {
                await rolesApi.setPermissions(role.id, permissions);
            }
            toast.success(`Role "${role.role_name}" created`);
            onCreated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Create failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                aria-hidden
                onClick={onClose}
                className="absolute inset-0 bg-black/40"
            />
            <form
                onSubmit={submit}
                className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-lg"
            >
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <h3 className="text-base font-semibold">+ New Role</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-md p-1 hover:bg-accent"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-3 md:grid-cols-2">
                        <FormField label="Role name" name="role_name" required>
                            <Input
                                value={roleName}
                                onChange={(e) => setRoleName(e.target.value)}
                                placeholder="e.g. Sales Lead"
                                disabled={submitting}
                            />
                        </FormField>
                        <FormField label="Role key" name="role_key" required
                            hint="Lowercase, underscore separated. Used by RBAC checks.">
                            <Input
                                value={roleKey}
                                onChange={(e) => {
                                    setTouchedKey(true);
                                    setRoleKey(e.target.value);
                                }}
                                placeholder="e.g. sales_lead"
                                disabled={submitting}
                            />
                        </FormField>
                    </div>

                    <FormField label="Description" name="description"
                        className="mt-3">
                        <textarea
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={submitting}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                    </FormField>

                    <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-sm font-semibold">Permissions</h4>
                            <span className="text-xs text-muted-foreground">
                                {totalSelected} capabilit{totalSelected === 1 ? 'y' : 'ies'} selected
                            </span>
                        </div>
                        {loadingMatrix ? (
                            <p className="text-sm text-muted-foreground">Loading matrix…</p>
                        ) : features.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No feature definitions available.
                            </p>
                        ) : (
                            <PermissionMatrix
                                features={features}
                                capabilities={capabilities}
                                value={permissions}
                                onChange={setPermissions}
                            />
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
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
                        {submitting ? 'Creating…' : 'Create role'}
                    </Button>
                </div>
            </form>
        </div>
    );
}

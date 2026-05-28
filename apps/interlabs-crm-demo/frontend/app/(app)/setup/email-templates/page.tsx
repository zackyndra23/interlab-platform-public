'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Mail, MailOff, Power } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import { isGlobalRole, ROLE_LABEL, type RoleKey } from '@/lib/rbac';
import { emailTemplatesApi } from '@/lib/global-api';
import type { EmailTemplate } from '@/lib/global-types';

/**
 * /setup/email-templates per IMPL_frontend §F5.
 *
 * Templates are grouped by `feature_group`. Each group accordion shows:
 *   - Group header with bulk Enable All / Disable All (Superadmin/CEO only)
 *   - Per-template row: name, trigger event, recipient roles, channel
 *     icons (email / dashboard), enable/disable action
 *
 * Non-Superadmin/CEO viewers get a read-only render — every action button
 * is disabled. The backend enforces the same rule via RBAC, but mirroring
 * it here avoids a confusing 403 round-trip.
 */
export default function EmailTemplatesPage() {
    const { user } = useAuth();
    const canEdit = !!user && isGlobalRole(user.role);

    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const [busyId, setBusyId] = useState<string | null>(null);
    const [busyGroup, setBusyGroup] = useState<string | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            const res = await emailTemplatesApi.list();
            setTemplates(res.rows);
        } catch (err) {
            toast.error(err instanceof Error
                ? err.message
                : 'Failed to load templates');
            setTemplates([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const grouped = useMemo(() => {
        const map = new Map<string, EmailTemplate[]>();
        for (const t of templates) {
            const key = t.feature_group || 'Other';
            const list = map.get(key) ?? [];
            list.push(t);
            map.set(key, list);
        }
        // Stable sort: alphabetical group, alphabetical template within.
        return Array.from(map.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([group, items]) => ({
                group,
                items: items.slice().sort((a, b) =>
                    a.template_name.localeCompare(b.template_name),
                ),
            }));
    }, [templates]);

    function toggleGroup(group: string): void {
        setOpenGroups((prev) => ({ ...prev, [group]: !(prev[group] ?? true) }));
    }

    async function toggleTemplate(t: EmailTemplate): Promise<void> {
        if (!canEdit) return;
        setBusyId(t.id);
        const desired = t.status === 'enabled' ? 'disabled' : 'enabled';
        // Optimistic flip.
        setTemplates((prev) => prev.map((x) =>
            x.id === t.id ? { ...x, status: desired } : x,
        ));
        try {
            if (desired === 'enabled') await emailTemplatesApi.enable(t.id);
            else await emailTemplatesApi.disable(t.id);
            toast.success(`${t.template_name} ${desired}`);
        } catch (err) {
            // Revert on failure.
            setTemplates((prev) => prev.map((x) =>
                x.id === t.id ? { ...x, status: t.status } : x,
            ));
            toast.error(err instanceof Error ? err.message : 'Toggle failed');
        } finally {
            setBusyId(null);
        }
    }

    async function bulkGroup(group: string, enable: boolean): Promise<void> {
        if (!canEdit) return;
        setBusyGroup(group);
        try {
            if (enable) await emailTemplatesApi.enableGroup(group);
            else await emailTemplatesApi.disableGroup(group);
            toast.success(`${enable ? 'Enabled' : 'Disabled'} all in ${group}`);
            await reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Bulk update failed');
        } finally {
            setBusyGroup(null);
        }
    }

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Setup · Email Templates</h2>
                <p className="text-xs text-muted-foreground">
                    {canEdit
                        ? 'Toggle delivery per template or per feature group. Disabling a template suppresses both its email and dashboard notification.'
                        : 'Read-only view. Only Superadmin and CEO can enable / disable templates.'}
                </p>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : grouped.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No templates configured.
                </p>
            ) : (
                <div className="space-y-3">
                    {grouped.map(({ group, items }) => {
                        const isOpen = openGroups[group] ?? true;
                        const enabledCount = items.filter((i) => i.status === 'enabled').length;
                        const groupBusy = busyGroup === group;
                        return (
                            <section
                                key={group}
                                className="overflow-hidden rounded-md border border-border bg-card"
                            >
                                <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(group)}
                                        className="flex items-center gap-2 text-sm font-semibold"
                                    >
                                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        <span>{group}</span>
                                        <span className="text-xs font-normal text-muted-foreground">
                                            {enabledCount} of {items.length} enabled
                                        </span>
                                    </button>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => bulkGroup(group, true)}
                                            disabled={!canEdit || groupBusy}
                                        >
                                            Enable all
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => bulkGroup(group, false)}
                                            disabled={!canEdit || groupBusy}
                                        >
                                            Disable all
                                        </Button>
                                    </div>
                                </header>

                                {isOpen && (
                                    <ul className="divide-y divide-border text-sm">
                                        {items.map((t) => {
                                            const isEnabled = t.status === 'enabled';
                                            const isBusy = busyId === t.id;
                                            const recipients = (t.recipient_roles_json ?? [])
                                                .map((r) => ROLE_LABEL[r as RoleKey] ?? r);
                                            return (
                                                <li
                                                    key={t.id}
                                                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium">{t.template_name}</p>
                                                            <StatusBadge
                                                                status={isEnabled ? 'enabled' : 'disabled'}
                                                                variant={isEnabled ? 'success' : 'muted'}
                                                            />
                                                        </div>
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            Trigger: <code className="font-mono">{t.trigger_event}</code>
                                                            {' · key: '}
                                                            <code className="font-mono">{t.template_key}</code>
                                                        </p>
                                                        {recipients.length > 0 && (
                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                Recipients: {recipients.join(', ')}
                                                            </p>
                                                        )}
                                                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                                            <span className="inline-flex items-center gap-1">
                                                                {t.send_email_enabled
                                                                    ? <Mail size={12} />
                                                                    : <MailOff size={12} className="opacity-50" />}
                                                                {t.send_email_enabled ? 'Email on' : 'Email off'}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1">
                                                                <Power size={12}
                                                                    className={t.send_dashboard_notification_enabled
                                                                        ? ''
                                                                        : 'opacity-50'}
                                                                />
                                                                {t.send_dashboard_notification_enabled
                                                                    ? 'Dashboard on'
                                                                    : 'Dashboard off'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={isEnabled ? 'outline' : 'primary'}
                                                        onClick={() => toggleTemplate(t)}
                                                        disabled={!canEdit || isBusy || groupBusy}
                                                    >
                                                        {isBusy
                                                            ? '…'
                                                            : isEnabled ? 'Disable' : 'Enable'}
                                                    </Button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

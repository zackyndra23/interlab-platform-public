'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Moon, Save, Sun, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { useThemeStore } from '@/stores/theme.store';
import { ROLE_LABEL } from '@/lib/rbac';
import { filesApi, settingsApi } from '@/lib/global-api';
import { cn } from '@/lib/utils';

/**
 * /settings per IMPL_frontend §F5.
 *
 * Four independent sections, each with its own Save button:
 *   1. Profile  — display name (email + role read-only)
 *   2. Avatar   — upload then PUT /api/users/:id with the new url
 *   3. Password — current + new + confirm; rejects mismatch client-side
 *   4. Theme    — toggles light/dark; theme.store handles persistence,
 *                 and we forward the choice to the server preferences
 *                 endpoint so other devices stay in sync
 */
export default function SettingsPage() {
    const { user } = useAuth();
    const setUser = useAuthStore((s) => s.setUser);
    const theme = useThemeStore((s) => s.theme);
    const setTheme = useThemeStore((s) => s.setTheme);

    if (!user) return null;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold">Settings</h2>
                <p className="text-xs text-muted-foreground">
                    Personal account preferences. Role and permissions live under Setup → Roles.
                </p>
            </div>

            <ProfileSection
                userId={user.id}
                email={user.email}
                role={user.role}
                initialDisplayName={user.display_name}
                onSaved={(profile) => setUser({ ...user, ...profile })}
            />

            <AvatarSection
                userId={user.id}
                currentAvatarUrl={user.avatar_url}
                displayName={user.display_name}
                onSaved={(avatarUrl) =>
                    setUser({ ...user, avatar_url: avatarUrl })}
            />

            <PasswordSection />

            <ThemeSection
                theme={theme}
                onChange={(t) => setTheme(t)}
            />
        </div>
    );
}

// ===========================================================================
// PROFILE
// ===========================================================================

function ProfileSection({
    userId, email, role, initialDisplayName, onSaved,
}: {
    userId: string;
    email: string;
    role: keyof typeof ROLE_LABEL;
    initialDisplayName: string;
    onSaved: (next: { display_name: string }) => void;
}) {
    const [displayName, setDisplayName] = useState(initialDisplayName);
    const [saving, setSaving] = useState(false);

    async function save(): Promise<void> {
        if (!displayName.trim()) {
            toast.error('Display name is required');
            return;
        }
        setSaving(true);
        try {
            await settingsApi.updateProfile(userId, { display_name: displayName.trim() });
            onSaved({ display_name: displayName.trim() });
            toast.success('Profile updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Section
            title="Profile"
            description="Your display name appears in the sidebar identity card and in chat / notification senders."
        >
            <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Display name" name="display_name" required>
                    <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        disabled={saving}
                    />
                </FormField>
                <FormField label="Email" name="email"
                    hint="Email is your login. Contact a Superadmin to change.">
                    <Input value={email} disabled />
                </FormField>
                <FormField label="Role" name="role"
                    hint="Roles are managed under Setup → Roles.">
                    <Input value={ROLE_LABEL[role]} disabled />
                </FormField>
            </div>
            <SectionActions onSave={save} saving={saving} />
        </Section>
    );
}

// ===========================================================================
// AVATAR
// ===========================================================================

function AvatarSection({
    userId, currentAvatarUrl, displayName, onSaved,
}: {
    userId: string;
    currentAvatarUrl: string | null;
    displayName: string;
    onSaved: (avatarUrl: string | null) => void;
}) {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(currentAvatarUrl);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    async function pick(file: File | undefined): Promise<void> {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Avatar must be 5MB or smaller');
            return;
        }
        setUploading(true);
        try {
            const uploaded = await filesApi.upload(file, 'user.avatar', userId);
            // Resolve a presigned URL so the preview renders even if the
            // bucket is private.
            const { url } = await filesApi.presignedUrl(uploaded.id);
            setAvatarUrl(url);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    }

    async function save(): Promise<void> {
        setSaving(true);
        try {
            await settingsApi.updateProfile(userId, { avatar_url: avatarUrl });
            onSaved(avatarUrl);
            toast.success('Avatar updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Section
            title="Avatar"
            description="Square images render best. Stored in MinIO; the sidebar card uses a presigned URL."
        >
            <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                    <Image
                        src={avatarUrl || '/company-logo.jpeg'}
                        alt={displayName}
                        fill
                        sizes="80px"
                        className="object-cover"
                    />
                </div>
                <div className="space-y-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                        <Upload size={14} />
                        {uploading ? 'Uploading…' : 'Choose new image'}
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={(e) => pick(e.target.files?.[0])}
                            disabled={uploading}
                        />
                    </label>
                    {avatarUrl && avatarUrl !== currentAvatarUrl && (
                        <p className="text-xs text-muted-foreground">
                            Previewing new avatar — click Save to apply.
                        </p>
                    )}
                </div>
            </div>
            <SectionActions onSave={save} saving={saving} disabled={uploading} />
        </Section>
    );
}

// ===========================================================================
// PASSWORD
// ===========================================================================

function PasswordSection() {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    async function save(): Promise<void> {
        if (!current || !next || !confirm) {
            toast.error('All password fields are required');
            return;
        }
        if (next.length < 8) {
            toast.error('New password must be at least 8 characters');
            return;
        }
        if (next !== confirm) {
            toast.error('New password and confirmation do not match');
            return;
        }
        setSaving(true);
        try {
            await settingsApi.changePassword({
                current_password: current,
                new_password: next,
            });
            toast.success('Password changed');
            setCurrent('');
            setNext('');
            setConfirm('');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Password change failed');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Section
            title="Password"
            description="At least 8 characters. Other devices stay signed in until their refresh token expires."
        >
            <div className="grid gap-3 md:grid-cols-3">
                <FormField label="Current password" name="current_password" required>
                    <Input
                        type="password"
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        disabled={saving}
                        autoComplete="current-password"
                    />
                </FormField>
                <FormField label="New password" name="new_password" required>
                    <Input
                        type="password"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        disabled={saving}
                        autoComplete="new-password"
                    />
                </FormField>
                <FormField label="Confirm new password" name="confirm_password" required>
                    <Input
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        disabled={saving}
                        autoComplete="new-password"
                    />
                </FormField>
            </div>
            <SectionActions onSave={save} saving={saving} label="Change password" />
        </Section>
    );
}

// ===========================================================================
// THEME
// ===========================================================================

function ThemeSection({
    theme, onChange,
}: {
    theme: 'light' | 'dark';
    onChange: (t: 'light' | 'dark') => void;
}) {
    const [saving, setSaving] = useState(false);

    async function persist(next: 'light' | 'dark'): Promise<void> {
        onChange(next);
        setSaving(true);
        try {
            await settingsApi.updatePreferences({ theme: next });
        } catch {
            // Local store update already happened; preference will re-sync
            // on next /me round-trip if the server save failed.
        } finally {
            setSaving(false);
        }
    }

    return (
        <Section
            title="Theme"
            description="Applies immediately. Stored on the server so it follows you to other devices."
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => persist('light')}
                    disabled={saving}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                        theme === 'light'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background hover:bg-accent',
                    )}
                >
                    <Sun size={14} /> Light
                </button>
                <button
                    type="button"
                    onClick={() => persist('dark')}
                    disabled={saving}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                        theme === 'dark'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background hover:bg-accent',
                    )}
                >
                    <Moon size={14} /> Dark
                </button>
            </div>
        </Section>
    );
}

// ===========================================================================
// SHARED LAYOUT
// ===========================================================================

function Section({
    title, description, children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-md border border-border bg-card p-4">
            <header className="mb-3">
                <h3 className="text-sm font-semibold">{title}</h3>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </header>
            {children}
        </section>
    );
}

function SectionActions({
    onSave, saving, disabled, label = 'Save',
}: {
    onSave: () => void;
    saving: boolean;
    disabled?: boolean;
    label?: string;
}) {
    return (
        <div className="mt-4 flex justify-end">
            <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || disabled}
            >
                <Save size={14} />
                {saving ? 'Saving…' : label}
            </Button>
        </div>
    );
}

'use client';

import { useEffect, useState } from 'react';
import { Settings2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { apiGet } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { isGlobalRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';

import { GeneralSection, type GeneralSettings } from './sections/GeneralSection';
import { EmailSection, type EmailSettings } from './sections/EmailSection';

type Section = 'general' | 'email';

type AllSettings = {
    general: GeneralSettings;
    email: EmailSettings;
};

export default function SettingsPage() {
    const user = useAuthStore((s) => s.user);
    const canEdit = user ? isGlobalRole(user.role) : false;
    const [active, setActive] = useState<Section>('general');
    const [settings, setSettings] = useState<AllSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        apiGet<AllSettings>('/api/settings')
            .then((data) => { if (!cancelled) setSettings(data); })
            .catch((err) => {
                if (!cancelled) {
                    toast.error(err instanceof Error ? err.message : 'Failed to load settings');
                }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Setup · Settings</h2>
                <p className="text-xs text-muted-foreground">
                    System-wide configuration. All roles can view; editing is
                    restricted to Superadmin and CEO.
                </p>
            </div>

            <div className="flex gap-6">
                <aside className="w-56 shrink-0">
                    <div className="space-y-4">
                        <div>
                            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                General
                            </p>
                            <nav className="space-y-1">
                                <SectionButton
                                    icon={Settings2}
                                    label="General"
                                    active={active === 'general'}
                                    onClick={() => setActive('general')}
                                />
                                <SectionButton
                                    icon={Mail}
                                    label="Email"
                                    active={active === 'email'}
                                    onClick={() => setActive('email')}
                                />
                            </nav>
                        </div>
                    </div>
                </aside>

                <main className="min-w-0 flex-1">
                    {loading && (
                        <div className="text-sm text-muted-foreground">Loading…</div>
                    )}
                    {!loading && settings && active === 'general' && (
                        <GeneralSection
                            data={settings.general}
                            canEdit={canEdit}
                            onSaved={(g) => setSettings((prev) => (prev ? { ...prev, general: g } : prev))}
                        />
                    )}
                    {!loading && settings && active === 'email' && (
                        <EmailSection
                            data={settings.email}
                            canEdit={canEdit}
                            onSaved={(e) => setSettings((prev) => (prev ? { ...prev, email: e } : prev))}
                        />
                    )}
                </main>
            </div>
        </div>
    );
}

function SectionButton({
    icon: Icon, label, active, onClick,
}: {
    icon: typeof Settings2;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
            )}
        >
            <Icon size={16} />
            <span>{label}</span>
        </button>
    );
}

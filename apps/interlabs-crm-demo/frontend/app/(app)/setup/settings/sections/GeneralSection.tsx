'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { api, apiPut } from '@/lib/api';

export type GeneralSettings = {
    company_name: string;
    company_main_domain: string;
    rtl_admin: boolean;
    rtl_customers: boolean;
    allowed_file_types: string;
    logo_url: string;
};

type Props = {
    data: GeneralSettings;
    canEdit: boolean;
    onSaved: (next: GeneralSettings) => void;
};

export function GeneralSection({ data, canEdit, onSaved }: Props) {
    const [form, setForm] = useState<GeneralSettings>({
        company_name: data.company_name ?? '',
        company_main_domain: data.company_main_domain ?? '',
        rtl_admin: !!data.rtl_admin,
        rtl_customers: !!data.rtl_customers,
        allowed_file_types: data.allowed_file_types ?? '',
        logo_url: data.logo_url ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    function set<K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    async function save() {
        setSaving(true);
        try {
            await apiPut('/api/settings', {
                general: {
                    company_name: form.company_name,
                    company_main_domain: form.company_main_domain,
                    rtl_admin: form.rtl_admin,
                    rtl_customers: form.rtl_customers,
                    allowed_file_types: form.allowed_file_types,
                },
            });
            toast.success('Settings saved');
            onSaved(form);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    async function onLogoPick(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('logo', file);
        setUploading(true);
        try {
            const res = await api.post<{ success: boolean; data: { url: string }; error?: string }>(
                '/api/settings/logo',
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            if (!res.data.success) throw new Error(res.data.error || 'Upload failed');
            const next = { ...form, logo_url: res.data.data.url };
            setForm(next);
            onSaved(next);
            toast.success('Logo uploaded');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    }

    function clearLogo() {
        const next = { ...form, logo_url: '' };
        setForm(next);
    }

    const disabled = !canEdit;

    return (
        <div className="max-w-3xl space-y-6">
            <h3 className="text-base font-semibold">General</h3>

            <div>
                <label className="mb-1 block text-sm font-medium">Company Logo</label>
                <div className="flex items-start gap-4">
                    <div className="relative flex h-24 w-48 items-center justify-center rounded-md border border-dashed border-input bg-muted/30">
                        {form.logo_url ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={form.logo_url}
                                    alt="Company logo"
                                    className="h-full w-full object-contain p-2"
                                />
                                {!disabled && (
                                    <button
                                        type="button"
                                        onClick={clearLogo}
                                        className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                                        aria-label="Remove logo"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </>
                        ) : (
                            <span className="text-xs text-muted-foreground">No logo</span>
                        )}
                    </div>
                    <div className="space-y-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="block text-xs"
                            onChange={onLogoPick}
                            disabled={disabled || uploading}
                        />
                        <p className="text-xs text-muted-foreground">
                            PNG/JPG up to 2&nbsp;MB. {uploading && 'Uploading…'}
                        </p>
                    </div>
                </div>
            </div>

            <FormField name="company_name" label="Company Name">
                <Input
                    id="company_name"
                    value={form.company_name}
                    onChange={(e) => set('company_name', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <FormField
                name="company_main_domain"
                label="Company Main Domain"
                hint="Used as the base URL in outgoing email links."
            >
                <Input
                    id="company_main_domain"
                    value={form.company_main_domain}
                    onChange={(e) => set('company_main_domain', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <RtlToggle
                name="rtl_admin"
                label="RTL (Admin Area)"
                value={form.rtl_admin}
                disabled={disabled}
                onChange={(v) => set('rtl_admin', v)}
            />
            <RtlToggle
                name="rtl_customers"
                label="RTL (Customers Area)"
                value={form.rtl_customers}
                disabled={disabled}
                onChange={(v) => set('rtl_customers', v)}
            />

            <FormField
                name="allowed_file_types"
                label="Allowed File Types"
                hint="Comma-separated list of file extensions."
            >
                <Input
                    id="allowed_file_types"
                    value={form.allowed_file_types}
                    onChange={(e) => set('allowed_file_types', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            {canEdit && (
                <div>
                    <Button onClick={save} disabled={saving}>
                        {saving ? 'Saving…' : 'Save Settings'}
                    </Button>
                </div>
            )}
        </div>
    );
}

function RtlToggle({
    name, label, value, disabled, onChange,
}: {
    name: string;
    label: string;
    value: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div>
            <label className="mb-1 block text-sm font-medium">{label}</label>
            <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                    <input
                        type="radio"
                        name={name}
                        checked={value === true}
                        onChange={() => onChange(true)}
                        disabled={disabled}
                    />
                    Yes
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="radio"
                        name={name}
                        checked={value === false}
                        onChange={() => onChange(false)}
                        disabled={disabled}
                    />
                    No
                </label>
            </div>
        </div>
    );
}

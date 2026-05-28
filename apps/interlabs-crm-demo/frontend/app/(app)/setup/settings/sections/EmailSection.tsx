'use client';

import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/shared/FormField';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';

export type EmailSettings = {
    mail_engine: string;
    protocol: string;
    encryption: string;
    smtp_host: string;
    smtp_port: number | string;
    from_email: string;
    smtp_username: string;
    smtp_password: string;
    charset: string;
    bcc_all_to: string;
    signature: string;
    predefined_header: string;
    predefined_footer: string;
    queue_enabled: boolean;
    queue_skip_attachments: boolean;
};

type EmailQueueRow = {
    id: string;
    to_address: string;
    subject: string;
    status: 'pending' | 'sent' | 'failed';
    attempts: number;
    last_error: string | null;
    created_at: string;
    sent_at: string | null;
};

type QueueResponse = {
    data: EmailQueueRow[];
    total: number;
    page: number;
    limit: number;
};

type Props = {
    data: EmailSettings;
    canEdit: boolean;
    onSaved: (next: EmailSettings) => void;
};

type Tab = 'smtp' | 'queue';

const PROTOCOL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'smtp',         label: 'SMTP' },
    { value: 'ms_oauth',     label: 'Microsoft OAuth 2.0' },
    { value: 'gmail_oauth',  label: 'Gmail OAuth 2.0' },
    { value: 'sendmail',     label: 'Sendmail' },
    { value: 'mail',         label: 'Mail' },
];

export function EmailSection({ data, canEdit, onSaved }: Props) {
    const [tab, setTab] = useState<Tab>('smtp');

    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex items-center gap-2 border-b border-border">
                <TabButton active={tab === 'smtp'}  onClick={() => setTab('smtp')}>SMTP Settings</TabButton>
                <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>Email Queue</TabButton>
            </div>
            {tab === 'smtp' && <SmtpTab data={data} canEdit={canEdit} onSaved={onSaved} />}
            {tab === 'queue' && <QueueTab canEdit={canEdit} data={data} onSaved={onSaved} />}
        </div>
    );
}

function TabButton({
    active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}

function SmtpTab({ data, canEdit, onSaved }: Props) {
    const [form, setForm] = useState<EmailSettings>({
        mail_engine: data.mail_engine ?? 'phpmailer',
        protocol: data.protocol ?? 'smtp',
        encryption: data.encryption ?? 'tls',
        smtp_host: data.smtp_host ?? '',
        smtp_port: data.smtp_port ?? 587,
        from_email: data.from_email ?? '',
        smtp_username: data.smtp_username ?? '',
        smtp_password: data.smtp_password ?? '',
        charset: data.charset ?? 'utf-8',
        bcc_all_to: data.bcc_all_to ?? '',
        signature: data.signature ?? '',
        predefined_header: data.predefined_header ?? '',
        predefined_footer: data.predefined_footer ?? '',
        queue_enabled: !!data.queue_enabled,
        queue_skip_attachments: !!data.queue_skip_attachments,
    });
    const [saving, setSaving] = useState(false);
    const [testTo, setTestTo] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<
        { kind: 'ok'; message: string } | { kind: 'err'; message: string } | null
    >(null);
    const [passwordDirty, setPasswordDirty] = useState(false);

    function set<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    async function save() {
        setSaving(true);
        try {
            const payload: Partial<EmailSettings> = {
                mail_engine: form.mail_engine,
                protocol: form.protocol,
                encryption: form.encryption,
                smtp_host: form.smtp_host,
                smtp_port: Number(form.smtp_port) || 587,
                from_email: form.from_email,
                smtp_username: form.smtp_username,
                charset: form.charset,
                bcc_all_to: form.bcc_all_to,
                signature: form.signature,
                predefined_header: form.predefined_header,
                predefined_footer: form.predefined_footer,
                queue_enabled: form.queue_enabled,
                queue_skip_attachments: form.queue_skip_attachments,
            };
            if (passwordDirty) payload.smtp_password = form.smtp_password;
            await apiPut('/api/settings', { email: payload });
            toast.success('Email settings saved');
            setPasswordDirty(false);
            onSaved(form);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    async function runTest() {
        if (!testTo.trim()) {
            toast.error('Enter a recipient email first');
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            await apiPost('/api/settings/test-email', { to: testTo.trim() });
            setTestResult({ kind: 'ok', message: `Test email sent to ${testTo.trim()}` });
        } catch (err) {
            setTestResult({
                kind: 'err',
                message: err instanceof Error ? err.message : 'Test failed',
            });
        } finally {
            setTesting(false);
        }
    }

    const disabled = !canEdit;

    return (
        <div className="space-y-6">
            <div>
                <label className="mb-1 block text-sm font-medium">Mail Engine</label>
                <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                        <input
                            type="radio"
                            checked={form.mail_engine === 'phpmailer'}
                            onChange={() => set('mail_engine', 'phpmailer')}
                            disabled={disabled}
                        />
                        PHPMailer
                    </label>
                </div>
            </div>

            <div>
                <label className="mb-1 block text-sm font-medium">Email Protocol</label>
                <div className="flex flex-wrap gap-4 text-sm">
                    {PROTOCOL_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="email_protocol"
                                checked={form.protocol === opt.value}
                                onChange={() => set('protocol', opt.value)}
                                disabled={disabled}
                            />
                            {opt.label}
                        </label>
                    ))}
                </div>
            </div>

            <FormField name="encryption" label="Email Encryption">
                <select
                    id="encryption"
                    value={form.encryption}
                    onChange={(e) => set('encryption', e.target.value)}
                    disabled={disabled}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <option value="">None</option>
                    <option value="ssl">SSL</option>
                    <option value="tls">TLS</option>
                </select>
            </FormField>

            <FormField name="smtp_host" label="SMTP Host">
                <Input
                    id="smtp_host"
                    value={form.smtp_host}
                    onChange={(e) => set('smtp_host', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <FormField name="smtp_port" label="SMTP Port">
                <Input
                    id="smtp_port"
                    type="number"
                    value={form.smtp_port}
                    onChange={(e) => set('smtp_port', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <FormField name="from_email" label="Email" hint="The from-address used on outgoing mail.">
                <Input
                    id="from_email"
                    type="email"
                    value={form.from_email}
                    onChange={(e) => set('from_email', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <div className="space-y-1">
                <label htmlFor="smtp_username" className="inline-flex items-center gap-1 text-sm font-medium leading-none">
                    SMTP Username
                    <span title="For Gmail/Outlook use the full email address as the username.">
                        <HelpCircle size={13} className="text-muted-foreground" />
                    </span>
                </label>
                <Input
                    id="smtp_username"
                    value={form.smtp_username}
                    onChange={(e) => set('smtp_username', e.target.value)}
                    disabled={disabled}
                />
            </div>

            <FormField name="smtp_password" label="SMTP Password">
                <Input
                    id="smtp_password"
                    type="password"
                    placeholder="••••••••"
                    value={form.smtp_password}
                    onChange={(e) => {
                        setPasswordDirty(true);
                        set('smtp_password', e.target.value);
                    }}
                    disabled={disabled}
                />
            </FormField>

            <FormField name="charset" label="Email Charset">
                <Input
                    id="charset"
                    value={form.charset}
                    onChange={(e) => set('charset', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <FormField name="bcc_all_to" label="BCC All Emails To">
                <Input
                    id="bcc_all_to"
                    value={form.bcc_all_to}
                    onChange={(e) => set('bcc_all_to', e.target.value)}
                    disabled={disabled}
                />
            </FormField>

            <FormField name="signature" label="Email Signature">
                <textarea
                    id="signature"
                    value={form.signature}
                    onChange={(e) => set('signature', e.target.value)}
                    disabled={disabled}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                />
            </FormField>

            <FormField name="predefined_header" label="Predefined Header">
                <textarea
                    id="predefined_header"
                    value={form.predefined_header}
                    onChange={(e) => set('predefined_header', e.target.value)}
                    disabled={disabled}
                    rows={12}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50"
                />
            </FormField>

            <FormField name="predefined_footer" label="Predefined Footer">
                <textarea
                    id="predefined_footer"
                    value={form.predefined_footer}
                    onChange={(e) => set('predefined_footer', e.target.value)}
                    disabled={disabled}
                    rows={12}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50"
                />
            </FormField>

            <div className="rounded-md border border-border p-4">
                <h4 className="text-sm font-semibold">Send Test Email</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                    Deliver a one-off message using the saved SMTP configuration
                    to confirm it works.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        className="max-w-xs"
                        type="email"
                        placeholder="recipient@example.com"
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        disabled={disabled || testing}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={runTest}
                        disabled={disabled || testing}
                    >
                        {testing ? 'Sending…' : 'Send Test'}
                    </Button>
                </div>
                {testResult && (
                    <p className={cn(
                        'mt-2 text-xs',
                        testResult.kind === 'ok' ? 'text-green-600' : 'text-destructive',
                    )}>
                        {testResult.message}
                    </p>
                )}
            </div>

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

function QueueTab({ data, canEdit, onSaved }: Props) {
    const [enabled, setEnabled] = useState<boolean>(!!data.queue_enabled);
    const [skipAttachments, setSkipAttachments] = useState<boolean>(!!data.queue_skip_attachments);
    const [page, setPage] = useState(1);
    const LIMIT = 25;
    const [rows, setRows] = useState<EmailQueueRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!canEdit) return;
        let cancelled = false;
        setLoading(true);
        apiGet<QueueResponse>('/api/settings/email-queue', { page, limit: LIMIT })
            .then((res) => {
                if (cancelled) return;
                setRows(res.data);
                setTotal(res.total);
            })
            .catch((err) => {
                if (!cancelled) {
                    toast.error(err instanceof Error ? err.message : 'Failed to load queue');
                }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [canEdit, page]);

    async function saveQueueFlags() {
        setSaving(true);
        try {
            await apiPut('/api/settings', {
                email: {
                    queue_enabled: enabled,
                    queue_skip_attachments: skipAttachments,
                },
            });
            toast.success('Queue settings saved');
            onSaved({ ...data, queue_enabled: enabled, queue_skip_attachments: skipAttachments });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    if (!canEdit) {
        return (
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Email queue requires Superadmin or CEO access.
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil(total / LIMIT));

    return (
        <div className="space-y-6">
            <YesNoToggle
                label="Enable Email Queue"
                value={enabled}
                disabled={!canEdit}
                onChange={setEnabled}
            />
            <YesNoToggle
                label="Do not add emails with attachments to the queue"
                value={skipAttachments}
                disabled={!canEdit}
                onChange={setSkipAttachments}
            />
            {canEdit && (
                <div>
                    <Button size="sm" onClick={saveQueueFlags} disabled={saving}>
                        {saving ? 'Saving…' : 'Save Settings'}
                    </Button>
                </div>
            )}

            <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold">Queue Entries</h4>
                    <Input
                        className="h-8 max-w-xs text-xs"
                        placeholder="Search… (coming soon)"
                        disabled
                    />
                </div>
                {loading && (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                )}
                {!loading && rows.length === 0 && (
                    <p className="text-xs text-muted-foreground">No entries found.</p>
                )}
                {!loading && rows.length > 0 && (
                    <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2">Subject</th>
                                    <th className="px-3 py-2">To</th>
                                    <th className="px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-t border-border">
                                        <td className="px-3 py-2">{r.subject}</td>
                                        <td className="px-3 py-2">{r.to_address}</td>
                                        <td className="px-3 py-2">
                                            <StatusBadge
                                                status={r.status}
                                                variant={statusVariant(r.status)}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {total > 0 && (
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Page {page} of {totalPages}</span>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                Previous
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function YesNoToggle({
    label, value, disabled, onChange,
}: {
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
                        checked={value === true}
                        onChange={() => onChange(true)}
                        disabled={disabled}
                    />
                    Yes
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="radio"
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

function statusVariant(status: EmailQueueRow['status']): 'success' | 'warning' | 'danger' {
    switch (status) {
        case 'sent':    return 'success';
        case 'pending': return 'warning';
        case 'failed':  return 'danger';
    }
}

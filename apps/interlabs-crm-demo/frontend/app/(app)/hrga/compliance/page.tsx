'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Eye, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { DataTable } from '@/components/shared/DataTable';
import { IconButton } from '@/components/shared/IconButton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { complianceApi } from '@/lib/hrga-api';
import {
    complianceFlagLabel, complianceFlagVariant, daysUntil,
    legalDocumentStatusVariant,
} from '@/lib/hrga-ui';
import { formatDate } from '@/lib/utils';
import type {
    ComplianceExpiringRow, ComplianceFlag, ComplianceSummary,
} from '@/lib/hrga-types';

export default function CompliancePage() {
    const router = useRouter();
    const [summary, setSummary] = useState<ComplianceSummary | null>(null);
    const [rows, setRows] = useState<ComplianceExpiringRow[]>([]);
    const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [withinDays, setWithinDays] = useState(90);
    const [flag, setFlag] = useState<ComplianceFlag | ''>('');
    const [loading, setLoading] = useState(true);

    async function reload(): Promise<void> {
        setLoading(true);
        try {
            const [sum, list] = await Promise.all([
                complianceApi.summary(),
                complianceApi.expiring({
                    page, limit,
                    within_days: withinDays,
                    compliance_flag: flag || undefined,
                }),
            ]);
            setSummary(sum);
            setRows(list.rows);
            setMeta({ total: list.meta?.total ?? list.rows.length });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load');
        } finally { setLoading(false); }
    }
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
        [page, limit, withinDays, flag]);

    const columns = useMemo<ColumnDef<ComplianceExpiringRow>[]>(() => [
        { header: 'Record #', accessorKey: 'legal_document_record_number' },
        { header: 'Name', accessorKey: 'document_name' },
        {
            header: 'Category', accessorKey: 'document_category',
            cell: ({ getValue }) => (getValue() as string) || '—',
        },
        {
            header: 'Expiry', accessorKey: 'expiry_date',
            cell: ({ row }) => formatDate(row.original.expiry_date) || '—',
        },
        {
            header: 'In Days',
            cell: ({ row }) => {
                const d = daysUntil(row.original.expiry_date);
                if (d === null) return '—';
                if (d < 0) return `${Math.abs(d)}d overdue`;
                return `${d}d`;
            },
        },
        {
            header: 'Status', accessorKey: 'document_status',
            cell: ({ getValue }) => {
                const s = getValue() as ComplianceExpiringRow['document_status'];
                return <StatusBadge status={s} variant={legalDocumentStatusVariant(s)} />;
            },
        },
        {
            header: 'Compliance', accessorKey: 'compliance_flag',
            cell: ({ getValue }) => {
                const f = getValue() as ComplianceFlag;
                return (
                    <StatusBadge
                        status={complianceFlagLabel(f)}
                        variant={complianceFlagVariant(f)}
                    />
                );
            },
        },
        {
            id: 'actions', header: '',
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton icon={Eye} tooltip="Open"
                        onClick={() => router.push(`/hrga/legalitas/${row.original.id}`)} />
                </div>
            ),
        },
    ], [router]);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Compliance & Expiry</h2>
                <p className="text-xs text-muted-foreground">
                    Surfaces the 90d / 30d / expired tiers maintained by the daily <code>hrga_expiry_monitor</code> background job.
                </p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <SummaryCard
                    title="OK"
                    count={summary?.ok ?? 0}
                    icon={ShieldCheck}
                    variant="success"
                    onClick={() => setFlag('ok')}
                />
                <SummaryCard
                    title="Expiring ≤90d"
                    count={summary?.expiring_soon_90 ?? 0}
                    icon={AlertTriangle}
                    variant="info"
                    onClick={() => setFlag('expiring_soon_90')}
                />
                <SummaryCard
                    title="Expiring ≤30d"
                    count={summary?.expiring_soon_30 ?? 0}
                    icon={AlertTriangle}
                    variant="warning"
                    onClick={() => setFlag('expiring_soon_30')}
                />
                <SummaryCard
                    title="Expired"
                    count={summary?.expired ?? 0}
                    icon={ShieldAlert}
                    variant="danger"
                    onClick={() => setFlag('expired')}
                />
            </div>

            <DataTable<ComplianceExpiringRow>
                columns={columns}
                data={rows}
                loading={loading}
                page={page}
                limit={limit}
                total={meta.total}
                onPageChange={setPage}
                onLimitChange={(l) => { setLimit(l); setPage(1); }}
                filterBar={
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-muted-foreground">Within</label>
                        <select
                            value={withinDays}
                            onChange={(e) => { setWithinDays(Number(e.target.value)); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value={30}>30 days</option>
                            <option value={60}>60 days</option>
                            <option value={90}>90 days</option>
                            <option value={180}>180 days</option>
                            <option value={360}>360 days</option>
                        </select>
                        <label className="text-muted-foreground">Flag</label>
                        <select
                            value={flag}
                            onChange={(e) => { setFlag(e.target.value as ComplianceFlag | ''); setPage(1); }}
                            className="h-8 rounded-md border border-input bg-background px-2"
                        >
                            <option value="">All</option>
                            <option value="ok">OK</option>
                            <option value="expiring_soon_90">Expiring ≤90d</option>
                            <option value="expiring_soon_30">Expiring ≤30d</option>
                            <option value="expired">Expired</option>
                        </select>
                    </div>
                }
            />
        </div>
    );
}

type Variant = 'success' | 'info' | 'warning' | 'danger';

function SummaryCard({
    title, count, icon: Icon, variant, onClick,
}: {
    title: string;
    count: number;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    variant: Variant;
    onClick?: () => void;
}) {
    const tone: Record<Variant, string> = {
        success: 'text-emerald-600 dark:text-emerald-400',
        info: 'text-primary',
        warning: 'text-amber-600 dark:text-amber-400',
        danger: 'text-destructive',
    };
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-md border border-border bg-card p-4 text-left hover:bg-accent/40"
        >
            <div className={`mb-2 inline-flex items-center gap-2 text-xs ${tone[variant]}`}>
                <Icon size={14} />
                {title}
            </div>
            <div className="text-2xl font-semibold">{count}</div>
        </button>
    );
}

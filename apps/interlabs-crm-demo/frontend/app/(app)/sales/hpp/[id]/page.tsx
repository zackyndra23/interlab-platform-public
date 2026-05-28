'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailSection } from '@/components/sales/DetailSection';
import { hppApi } from '@/lib/sales-api';
import { hppVariant } from '@/lib/sales-ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { HargaPokokPenjualan, HppWorkflow } from '@/lib/sales-types';

const TRANSITIONS: HppWorkflow[] = ['submitted', 'approved'];

export default function HppDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [row, setRow] = useState<HargaPokokPenjualan | null>(null);
    const [loading, setLoading] = useState(true);

    async function load(): Promise<void> {
        setLoading(true);
        try { setRow(await hppApi.get(params.id)); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed'); }
        finally { setLoading(false); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

    async function transition(next: HppWorkflow): Promise<void> {
        if (!row) return;
        try {
            await hppApi.transition(row.id, next);
            toast.success(`Moved to ${next}`);
            load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Transition failed');
        }
    }

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!row) return <p className="text-sm text-muted-foreground">Not found</p>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">HPP {row.hpp_record_number}</h2>
                    <p className="text-xs text-muted-foreground">
                        {formatDate(row.hpp_date)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={row.workflow_status} variant={hppVariant(row.workflow_status)} />
                    <Button size="sm" variant="outline"
                        onClick={() => router.push(`/sales/hpp/${row.id}/edit`)}>
                        <Pencil size={14} />
                        Edit
                    </Button>
                </div>
            </div>
            <div className="flex flex-wrap gap-1">
                {TRANSITIONS.map((t) => (
                    <Button key={t} size="sm"
                        variant={t === row.workflow_status ? 'secondary' : 'outline'}
                        disabled={t === row.workflow_status}
                        onClick={() => transition(t)}>
                        {t}
                    </Button>
                ))}
            </div>

            <DetailSection title="Items">
                {row.item_list && row.item_list.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-2 py-1 text-left">Item</th>
                                <th className="px-2 py-1 text-right">Qty</th>
                                <th className="px-2 py-1 text-left">Unit</th>
                                <th className="px-2 py-1 text-right">Cost</th>
                                <th className="px-2 py-1 text-right">Selling</th>
                                <th className="px-2 py-1 text-right">Margin</th>
                                <th className="px-2 py-1 text-right">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {row.item_list.map((it, idx) => (
                                <tr key={idx} className="border-t border-border">
                                    <td className="px-2 py-1">{it.item_name}</td>
                                    <td className="px-2 py-1 text-right">{it.qty}</td>
                                    <td className="px-2 py-1">{it.unit}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(it.cost_price, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(it.selling_price, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(it.margin_amount, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{Number(it.margin_percent || 0).toFixed(1)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <p className="text-sm text-muted-foreground">No items</p>}
            </DetailSection>

            <DetailSection title="Totals" fields={[
                { label: 'Total Cost', value: formatCurrency(row.total_cost, row.currency) },
                { label: 'Total Selling', value: formatCurrency(row.total_selling_price, row.currency) },
                { label: 'Gross Margin', value: formatCurrency(row.gross_margin_total, row.currency) },
            ]} />

            <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-sm">
                    {row.notes || <span className="text-muted-foreground">—</span>}
                </p>
            </DetailSection>
        </div>
    );
}

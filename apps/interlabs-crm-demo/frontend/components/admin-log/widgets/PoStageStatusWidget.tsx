'use client';

import { useEffect, useState } from 'react';

import { awbApi, deliveryOrdersApi } from '@/lib/admin-log-api';
import type { AwbRecord, DeliveryOrder } from '@/lib/admin-log-types';

/**
 * Widget 1: PO Stage Status Board (MOD_admin_log §WIDGETS).
 *
 * Counts derived from AWB + DO records — `awb.current_awb_status`
 * maps to Shipped/Customs/Arrived; DO `current_do_status` maps to
 * Delivery (Registered) / Delivered (Arrived). No dedicated
 * `/api/dashboard/admin-log` endpoint yet, so we pull from the list
 * endpoints with `limit=100`.
 */

export function PoStageStatusWidget() {
    const [awbs, setAwbs] = useState<AwbRecord[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [a, d] = await Promise.all([
                    awbApi.list({ limit: 100 }),
                    deliveryOrdersApi.list({ limit: 100 }),
                ]);
                setAwbs(a.rows);
                setDos(d.rows);
            } catch {
                setAwbs([]); setDos([]);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const shipped = awbs.filter((a) => a.current_awb_status === 'Registered').length;
    const customs = awbs.filter((a) => a.current_awb_status === 'Processed').length;
    const arrived = awbs.filter((a) => a.current_awb_status === 'Arrived').length;
    const delivery = dos.filter((d) => d.current_do_status === 'Registered').length;
    const delivered = dos.filter((d) => d.current_do_status === 'Arrived').length;

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">PO Stage Board</h3>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                    <Stat label="Shipped" value={shipped} />
                    <Stat label="Customs" value={customs} />
                    <Stat label="Arrived" value={arrived} />
                    <Stat label="Delivery" value={delivery} />
                    <Stat label="Delivered" value={delivered} />
                </div>
            )}
        </section>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

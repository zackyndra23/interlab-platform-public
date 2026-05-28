'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SalesForecastForm } from '@/components/sales/SalesForecastForm';
import { forecastsApi } from '@/lib/sales-api';
import type { SalesForecast } from '@/lib/sales-types';

export default function EditForecastPage() {
    const params = useParams<{ id: string }>();
    const [row, setRow] = useState<SalesForecast | null>(null);

    useEffect(() => {
        forecastsApi.get(params.id)
            .then(setRow)
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
    }, [params.id]);

    if (!row) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Edit Sales Forecast</h2>
                <p className="text-xs text-muted-foreground">{row.forecast_record_number}</p>
            </div>
            <SalesForecastForm existing={row} />
        </div>
    );
}

import { SalesForecastForm } from '@/components/sales/SalesForecastForm';

export default function NewForecastPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Sales Forecast</h2>
            <SalesForecastForm />
        </div>
    );
}

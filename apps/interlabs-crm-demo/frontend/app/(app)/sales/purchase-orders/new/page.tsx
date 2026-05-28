import { SalesPoForm } from '@/components/sales/SalesPoForm';

export default function NewSalesPoPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Sales Purchase Order</h2>
            <SalesPoForm />
        </div>
    );
}

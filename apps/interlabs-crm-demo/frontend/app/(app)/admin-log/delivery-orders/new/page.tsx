import { DeliveryOrderForm } from '@/components/admin-log/DeliveryOrderForm';

export default function NewDeliveryOrderPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Delivery Order</h2>
            <DeliveryOrderForm />
        </div>
    );
}

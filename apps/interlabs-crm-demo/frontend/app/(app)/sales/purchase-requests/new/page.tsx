import { PurchaseRequestForm } from '@/components/sales/PurchaseRequestForm';

export default function NewPurchaseRequestPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Purchase Request</h2>
            <PurchaseRequestForm />
        </div>
    );
}

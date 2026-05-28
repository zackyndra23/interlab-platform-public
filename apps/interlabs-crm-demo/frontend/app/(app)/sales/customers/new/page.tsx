import { CustomerForm } from '@/components/sales/CustomerForm';

export default function NewCustomerPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Customer</h2>
            <CustomerForm />
        </div>
    );
}

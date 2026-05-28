import { InvoiceManufactureForm } from '@/components/finance/InvoiceManufactureForm';

export default function NewInvoiceManufacturePage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Invoice Manufacture</h2>
            <InvoiceManufactureForm />
        </div>
    );
}

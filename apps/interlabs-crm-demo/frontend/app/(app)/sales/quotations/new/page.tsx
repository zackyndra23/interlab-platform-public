import { QuotationForm } from '@/components/sales/QuotationForm';

export default function NewQuotationPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Quotation</h2>
            <QuotationForm />
        </div>
    );
}

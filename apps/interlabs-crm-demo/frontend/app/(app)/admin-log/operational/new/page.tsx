import { OperationalForm } from '@/components/admin-log/OperationalForm';

export default function NewOperationalPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">New Operational Entry</h2>
            <OperationalForm />
        </div>
    );
}

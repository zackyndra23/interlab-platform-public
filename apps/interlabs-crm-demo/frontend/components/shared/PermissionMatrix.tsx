'use client';

import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/Checkbox';

/**
 * Feature × capability checkbox grid. Used inside the "+ New Role" modal
 * and the Roles detail page. Pure controlled component — the caller
 * owns `value` and the `onChange` handler maps back to the backend
 * `role_permissions` rows.
 */

export type PermissionFeature = {
    feature_key: string;
    feature_name: string;
    module_group: string;
};

export type PermissionCapability = {
    capability_key: string;
    capability_name: string;
};

export type PermissionMatrixValue = Record<string, string[]>; // feature_key → [capability_key]

export function PermissionMatrix({
    features, capabilities, value, onChange, readOnly,
}: {
    features: PermissionFeature[];
    capabilities: PermissionCapability[];
    value: PermissionMatrixValue;
    onChange: (next: PermissionMatrixValue) => void;
    readOnly?: boolean;
}) {
    function toggle(feature: string, capability: string): void {
        if (readOnly) return;
        const current = new Set(value[feature] || []);
        if (current.has(capability)) current.delete(capability);
        else current.add(capability);
        onChange({ ...value, [feature]: Array.from(current) });
    }

    // Group features by module_group for readability.
    const grouped = features.reduce<Record<string, PermissionFeature[]>>((acc, f) => {
        (acc[f.module_group] ||= []).push(f);
        return acc;
    }, {});

    return (
        <div className="space-y-4">
            {Object.entries(grouped).map(([group, items]) => (
                <div key={group} className="rounded-md border border-border">
                    <div className="border-b border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Feature</th>
                                {capabilities.map((c) => (
                                    <th key={c.capability_key} className="px-2 py-2 text-center font-medium text-muted-foreground">
                                        {c.capability_name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((f) => (
                                <tr key={f.feature_key} className="border-t border-border">
                                    <td className="px-3 py-1.5">{f.feature_name}</td>
                                    {capabilities.map((c) => {
                                        const checked = (value[f.feature_key] || []).includes(c.capability_key);
                                        return (
                                            <td
                                                key={c.capability_key}
                                                className={cn('px-2 py-1.5 text-center', readOnly && 'opacity-70')}
                                            >
                                                <Checkbox
                                                    checked={checked}
                                                    onChange={() => toggle(f.feature_key, c.capability_key)}
                                                    disabled={readOnly}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
}

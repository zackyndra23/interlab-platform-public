'use client';
import { useEffect, useState } from 'react';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/admin-permissions-ui';
import type { RoleKey, FeatureDef, CapabilityDef, RolePermissionRow, RoleLevel } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';

export default function PermissionMatrix() {
    const [features, setFeatures] = useState<FeatureDef[]>([]);
    const [caps, setCaps] = useState<CapabilityDef[]>([]);
    const [matrix, setMatrix] = useState<RolePermissionRow[]>([]);
    const [levelsByRole, setLevelsByRole] = useState<Record<string, RoleLevel[]>>({});
    const [activeRole, setActiveRole] = useState<RoleKey>('sales');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            adminRbacApi.listFeatures(),
            adminRbacApi.listCapabilities(),
            adminRbacApi.matrix(),
            Promise.all(ROLE_KEYS.map(r => adminRbacApi.listLevels(r).then(ls => [r, ls] as const))),
        ]).then(([f, c, m, levels]) => {
            setFeatures(f);
            setCaps(c);
            setMatrix(m);
            setLevelsByRole(Object.fromEntries(levels));
            setLoading(false);
        }).catch((e: unknown) => {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Load failed: ${err?.response?.data?.error || err?.message || 'unknown'}`);
            setLoading(false);
        });
    }, []);

    function isEnabled(role_id: string, level_id: string, feature_id: string, capability_id: string) {
        return matrix.some(r =>
            r.role_id === role_id && r.level_id === level_id &&
            r.feature_id === feature_id && r.capability_id === capability_id,
        );
    }

    async function toggle(row: RolePermissionRow, enabled: boolean) {
        // Optimistic update
        setMatrix(prev => enabled
            ? [...prev, row]
            : prev.filter(r => !(
                r.role_id === row.role_id &&
                r.level_id === row.level_id &&
                r.feature_id === row.feature_id &&
                r.capability_id === row.capability_id
            )));
        try {
            await adminRbacApi.toggleCell({ ...row, enabled });
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Toggle failed: ${err?.response?.data?.error || err?.message}`);
            // Rollback optimistic update
            setMatrix(prev => enabled
                ? prev.filter(r => !(
                    r.role_id === row.role_id &&
                    r.level_id === row.level_id &&
                    r.feature_id === row.feature_id &&
                    r.capability_id === row.capability_id
                ))
                : [...prev, row]);
        }
    }

    if (loading) return <div className="p-6">Loading permission matrix...</div>;

    const levels = levelsByRole[activeRole] || [];
    const role_id = levels[0]?.role_id;

    return (
        <div className="p-6">
            <h1 className="text-2xl font-semibold mb-4">Permission Matrix</h1>
            <div className="flex gap-2 mb-4 flex-wrap">
                {ROLE_KEYS.map(r => (
                    <button
                        key={r}
                        onClick={() => setActiveRole(r)}
                        className={`px-3 py-1 rounded ${activeRole === r ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                    >
                        {ROLE_LABELS[r]}
                    </button>
                ))}
            </div>
            {!levels.length ? (
                <div className="text-sm text-gray-500">
                    No levels defined for this role yet. Use the Levels admin to create some.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                        <thead>
                            <tr>
                                <th className="border p-2 text-left whitespace-nowrap">Feature</th>
                                {levels.map(l => caps.map(c => (
                                    <th key={`${l.id}-${c.id}`} className="border p-1 text-center">
                                        <div className="font-semibold">{l.level_name}</div>
                                        <div className="font-mono text-gray-500">{c.capability_key}</div>
                                    </th>
                                )))}
                            </tr>
                        </thead>
                        <tbody>
                            {features.map(f => (
                                <tr key={f.id}>
                                    <td className="border p-2 whitespace-nowrap">{f.feature_name}</td>
                                    {levels.map(l => caps.map(c => {
                                        const checked = role_id ? isEnabled(role_id, l.id, f.id, c.id) : false;
                                        return (
                                            <td key={`${l.id}-${c.id}`} className="border p-1 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={(e) => {
                                                        if (role_id) {
                                                            void toggle(
                                                                { role_id, level_id: l.id, feature_id: f.id, capability_id: c.id },
                                                                e.target.checked,
                                                            );
                                                        }
                                                    }}
                                                />
                                            </td>
                                        );
                                    }))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

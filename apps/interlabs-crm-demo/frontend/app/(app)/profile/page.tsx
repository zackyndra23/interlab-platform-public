'use client';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { AvatarDisplay } from '@/components/avatar/AvatarDisplay';
import { AvatarUploader } from '@/components/avatar/AvatarUploader';
import { ROLE_LABEL } from '@/lib/rbac';

export default function ProfilePage() {
  const user = useAuthStore(s => s.user);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!user) return null;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Profile</h1>
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <AvatarDisplay
            userId={user.id}
            size={96}
            className="border-2 border-gray-200"
            refreshKey={refreshKey}
          />
          <div>
            <div className="font-medium">{user.display_name}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
            <div className="text-sm text-gray-500">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
        <AvatarUploader onUploaded={() => setRefreshKey(k => k + 1)} />
      </section>
    </div>
  );
}

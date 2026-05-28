'use client';
import { useEffect, useState } from 'react';
import { profileApi } from '@/lib/profile-api';
import type { TwoFactorMethod } from '@/lib/twofactor-types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { AvatarDisplay } from '@/components/avatar/AvatarDisplay';
import { AvatarUploader } from '@/components/avatar/AvatarUploader';
import { ChangePasswordSection } from '@/components/profile/ChangePasswordSection';
import { TwoFactorSection } from '@/components/profile/TwoFactorSection';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';

export default function EditProfilePage() {
  const user = useAuthStore(s => s.user);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>('disabled');
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });

  useEffect(() => {
    profileApi.getMyProfile()
      .then(p => {
        setForm({
          first_name: p.first_name ?? '',
          last_name: p.last_name ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
        });
        setTwoFactorMethod(p.two_factor_method ?? 'disabled');
      })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        toast.error(`Load failed: ${err?.response?.data?.error || err?.message}`);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.email || !form.phone) {
      toast.error('All fields are required');
      return;
    }
    if (!/^\+[1-9]\d{1,14}$/.test(form.phone)) {
      toast.error('Phone must be in E.164 format (e.g. +628123456789)');
      return;
    }
    setSaving(true);
    try {
      await profileApi.updateMyProfile(form);
      toast.success('Profile updated');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Save failed: ${e?.response?.data?.error || e?.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;
  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Edit Profile</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Profile</h2>
        <div className="flex items-center gap-4 mb-4">
          <AvatarDisplay
            userId={user.id}
            size={96}
            className="border-2 border-gray-200 dark:border-gray-700"
            refreshKey={refreshKey}
          />
          <AvatarUploader onUploaded={() => setRefreshKey(k => k + 1)} />
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <label className="block">
            <span className="text-sm">First Name <span className="text-red-500">*</span></span>
            <Input
              value={form.first_name}
              onChange={e => setForm({ ...form, first_name: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm">Last Name <span className="text-red-500">*</span></span>
            <Input
              value={form.last_name}
              onChange={e => setForm({ ...form, last_name: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm">Email <span className="text-red-500">*</span></span>
            <Input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm">Phone <span className="text-red-500">*</span></span>
            <Input
              type="tel"
              placeholder="+628123456789"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              required
            />
          </label>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </form>
      </section>

      <ChangePasswordSection />

      <TwoFactorSection
        currentMethod={twoFactorMethod}
        onMethodChanged={(m) => setTwoFactorMethod(m)}
      />
    </div>
  );
}

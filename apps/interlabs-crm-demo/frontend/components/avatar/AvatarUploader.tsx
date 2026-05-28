'use client';
import { useState, useRef } from 'react';
import { avatarApi } from '@/lib/avatar-api';
import axios from 'axios';
import { toast } from 'sonner';

interface Props {
  onUploaded?: () => void;
  className?: string;
}

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_SIZE = 5 * 1024 * 1024;

export function AvatarUploader({ onUploaded, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Only PNG, JPEG, or WebP images are allowed');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`File too large (max ${Math.round(MAX_SIZE/1024/1024)}MB)`);
      return;
    }
    setUploading(true);
    try {
      // 1. Get presigned PUT URL
      const presign = await avatarApi.presign();
      // 2. Upload directly to MinIO (fresh axios instance — no auth headers / baseURL)
      await axios.put(presign.uploadUrl, file, { headers: { 'Content-Type': file.type } });
      // 3. Commit
      await avatarApi.commit(presign.objectKey);
      toast.success('Avatar updated');
      onUploaded?.();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(`Upload failed: ${err?.response?.data?.error || err?.message || 'unknown'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onChange} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
      >
        {uploading ? 'Uploading...' : 'Change avatar'}
      </button>
    </div>
  );
}

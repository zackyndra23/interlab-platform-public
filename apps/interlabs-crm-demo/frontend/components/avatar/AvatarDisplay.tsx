'use client';
import { useEffect, useState } from 'react';
import { avatarApi } from '@/lib/avatar-api';

interface Props {
  userId: string;
  size?: number; // px
  className?: string;
  refreshKey?: number; // bump to force re-fetch after upload
}

export function AvatarDisplay({ userId, size = 40, className = '', refreshKey = 0 }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    avatarApi.get(userId).then(r => {
      if (!cancelled) setUrl(r.url);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  if (error || !url) {
    return (
      <div
        className={`rounded-full bg-gray-300 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={url}
      alt="avatar"
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
      onError={() => setError(true)}
    />
  );
}

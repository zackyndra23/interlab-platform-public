import { api } from './api';

export interface AvatarPresign {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface AvatarCommitResult {
  fileId: string;
  objectKey: string;
  thumbKey: string;
}

export interface AvatarGetResult {
  url: string;
  fallback: boolean;
  expiresIn: number;
}

export const avatarApi = {
  presign: () =>
    api.post<{ data: AvatarPresign }>('/api/users/me/avatar/presign', {}).then(r => r.data.data),
  commit: (rawObjectKey: string) =>
    api.post<{ data: AvatarCommitResult }>('/api/users/me/avatar/commit', { rawObjectKey }).then(r => r.data.data),
  get: (userId: string) =>
    api.get<{ data: AvatarGetResult }>(`/api/users/${userId}/avatar`).then(r => r.data.data),
};

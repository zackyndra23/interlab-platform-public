import { api } from './api';
import type { UserProfile } from './profile-types';

export const profileApi = {
  getMyProfile: () =>
    api.get<{ data: UserProfile }>('/api/users/me/profile').then(r => r.data.data),
  updateMyProfile: (body: { first_name: string; last_name: string; email: string; phone: string }) =>
    api.patch<{ data: UserProfile }>('/api/users/me/profile', body).then(r => r.data.data),
  changePassword: (body: { current_password: string; new_password: string }) =>
    api.post<{ data: { message: string } }>('/api/auth/change-password', body).then(r => r.data.data),
};

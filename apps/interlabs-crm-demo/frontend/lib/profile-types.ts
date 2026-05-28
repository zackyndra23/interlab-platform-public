import type { TwoFactorMethod } from './twofactor-types';

export interface UserProfile {
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  role: string;
  two_factor_method: TwoFactorMethod;
}

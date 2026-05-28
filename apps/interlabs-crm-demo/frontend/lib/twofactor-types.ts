export type TwoFactorMethod = 'disabled' | 'email' | 'totp';

export interface TotpSetupResponse {
  secret: string;
  qr_data_url: string;
  otpauth_uri: string;
}

export interface BackupCodesResponse {
  backup_codes: string[];
}

export interface LoginRequires2faResponse {
  requires_2fa: true;
  pending_token: string;
  method: 'email' | 'totp';
}

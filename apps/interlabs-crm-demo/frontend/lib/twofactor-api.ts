import { api } from './api';
import type { TotpSetupResponse, BackupCodesResponse } from './twofactor-types';

export const twofactorApi = {
  setupTotp: () =>
    api.post<{ data: TotpSetupResponse }>('/api/auth/2fa/setup-totp', {}).then(r => r.data.data),
  verifyTotpSetup: (body: { secret: string; code: string }) =>
    api.post<{ data: BackupCodesResponse }>('/api/auth/2fa/verify-totp-setup', body).then(r => r.data.data),
  enableEmail: () =>
    api.post('/api/auth/2fa/enable-email', {}).then(r => r.data),
  disable: (body: { current_password: string; code?: string }) =>
    api.post('/api/auth/2fa/disable', body).then(r => r.data),
  loginVerify: (body: { pending_token: string; code: string }) =>
    api.post('/api/auth/login/2fa-verify', body).then(r => r.data.data),
  resendEmail: (body: { pending_token: string }) =>
    api.post('/api/auth/2fa/email-resend', body).then(r => r.data),
};

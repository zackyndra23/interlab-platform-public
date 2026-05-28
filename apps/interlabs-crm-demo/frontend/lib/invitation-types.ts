import type { UserProfile } from './rbac';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
    id: string;
    email: string;
    role_key: string;
    level_id: string | null;
    status: InvitationStatus;
    invited_by_user_id: string;
    inviter_role_key: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    created_at: string;
}

export interface CreateInvitationResult {
    invitationId: string;
    activationToken: string;
    initialPassword: string;
    expiresAt: string;
}

/** Shape returned by POST /api/auth/activate — same as login response. */
export interface ActivateResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    refresh_expires_at: string;
    user: UserProfile;
}

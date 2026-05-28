import type { InvitationStatus } from './invitation-types';

/**
 * Pill-style badge classes for invitation status. Colored translucent
 * background + bordered + readable white-ish text in both light/dark mode.
 * Pair with the inline-block pattern: `<span className={STATUS_COLORS[s]}>`.
 */
export const STATUS_COLORS: Record<InvitationStatus, string> = {
    pending:  'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/25 text-yellow-100 border border-yellow-500/60',
    accepted: 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/25 text-green-100 border border-green-500/60',
    expired:  'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/25 text-gray-100 border border-gray-500/60',
    revoked:  'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/25 text-red-100 border border-red-500/60',
};

export const STATUS_LABELS: Record<InvitationStatus, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    expired: 'Expired',
    revoked: 'Revoked',
};

'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import { ROLE_LABEL, type UserProfile } from '@/lib/rbac';
import { AvatarDisplay } from '@/components/avatar/AvatarDisplay';
import { UserMenuDropdown } from '@/components/layout/UserMenuDropdown';

/**
 * User identity card pinned at the top of the sidebar.
 *
 * Clicking anywhere on the card toggles a drop-down menu with:
 *   - "Edit Profile" (navigates to /profile/edit — change password and 2FA
 *     settings live on that page)
 *   - "Logout"
 *
 * When the sidebar is collapsed, only the avatar is shown; clicking it
 * still opens the same dropdown.
 */
export function UserCard({
    user, collapsed,
}: {
    user: UserProfile;
    collapsed: boolean;
}) {
    const [menuOpen, setMenuOpen] = useState(false);

    function handleCardClick(e: React.MouseEvent) {
        e.preventDefault();
        setMenuOpen((v) => !v);
    }

    return (
        <div className={cn(
            'relative border-b border-border px-3 py-3',
            collapsed && 'flex justify-center',
        )}>
            {/* Drop-down menu anchored under this card */}
            <UserMenuDropdown open={menuOpen} onClose={() => setMenuOpen(false)} />

            {/* Clickable card */}
            <button
                type="button"
                onClick={handleCardClick}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                className={cn(
                    'flex w-full items-center gap-3 rounded px-1 py-1',
                    'transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    collapsed && 'justify-center',
                )}
            >
                <div className="relative h-10 w-10 shrink-0">
                    <AvatarDisplay userId={user.id} size={40} className="border" />
                </div>
                {!collapsed && (
                    <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-semibold">{user.display_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                            {ROLE_LABEL[user.role]}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                )}
            </button>
        </div>
    );
}

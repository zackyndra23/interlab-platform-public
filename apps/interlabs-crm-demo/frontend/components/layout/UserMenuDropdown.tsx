'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, LogOut } from 'lucide-react';

import { apiPost } from '@/lib/api';
import { clearTokens, getRefreshToken } from '@/lib/auth';
import { websocket } from '@/lib/websocket';
import { useAuthStore } from '@/stores/auth.store';

interface Props {
    open: boolean;
    onClose: () => void;
}

/**
 * Drop-down menu anchored under the user card at the top of the sidebar.
 * Renders two items:
 *   - "Edit Profile" (navigates to /profile/edit — also the entry point for
 *     change password + Two-Factor Authentication settings)
 *   - "Logout"       (runs the existing logout flow)
 *
 * Dismisses on click-outside or Escape.
 */
export function UserMenuDropdown({ open, onClose }: Props) {
    const router = useRouter();
    const ref = useRef<HTMLDivElement>(null);

    // Click-outside handler
    useEffect(() => {
        if (!open) return;
        function handleMouseDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [open, onClose]);

    // Escape key handler
    useEffect(() => {
        if (!open) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    async function handleLogout() {
        onClose();
        try {
            const rt = getRefreshToken();
            await apiPost('/api/auth/logout', rt ? { refresh_token: rt } : {});
        } catch {
            // ignore — clear client state regardless
        } finally {
            clearTokens();
            useAuthStore.getState().clear();
            websocket.disconnect();
            router.replace('/login');
        }
    }

    function handleEditProfile() {
        onClose();
        router.push('/profile/edit');
    }

    if (!open) return null;

    return (
        <div
            ref={ref}
            className="absolute top-full left-0 right-0 mt-2 z-50 rounded-md shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 overflow-hidden"
        >
            <button
                type="button"
                onClick={handleEditProfile}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm transition-colors"
            >
                <Pencil size={14} />
                <span>Edit Profile</span>
            </button>

            <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm transition-colors text-red-600 dark:text-red-400"
            >
                <LogOut size={14} />
                <span>Logout</span>
            </button>
        </div>
    );
}

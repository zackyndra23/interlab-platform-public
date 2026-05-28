/**
 * Token persistence + minimal auth helpers.
 *
 * Storage strategy (per IMPL_frontend §F2): remember-me logins land in
 * `localStorage` so the token survives tab close; default logins land in
 * `sessionStorage` so the token dies with the tab. We normalise both into a
 * single read path below so callers never need to know which one holds it.
 *
 * The Axios interceptor reads these values on every request; the login
 * handler writes them once after POST /api/auth/login succeeds.
 */

const ACCESS_KEY = 'auth.access_token';
const REFRESH_KEY = 'auth.refresh_token';
const REMEMBER_KEY = 'auth.remember';

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function store(remember: boolean): Storage | null {
    if (!isBrowser()) return null;
    return remember ? window.localStorage : window.sessionStorage;
}

function readFromEither(key: string): string | null {
    if (!isBrowser()) return null;
    return (
        window.localStorage.getItem(key)
        || window.sessionStorage.getItem(key)
        || null
    );
}

export type StoredTokens = {
    accessToken: string;
    refreshToken: string;
    rememberMe: boolean;
};

export function setTokens(t: StoredTokens): void {
    if (!isBrowser()) return;
    // Clear from BOTH storages first so a remember_me toggle doesn't leave
    // orphaned tokens in the wrong place.
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(REMEMBER_KEY);
    window.sessionStorage.removeItem(ACCESS_KEY);
    window.sessionStorage.removeItem(REFRESH_KEY);
    window.sessionStorage.removeItem(REMEMBER_KEY);

    const target = store(t.rememberMe);
    if (!target) return;
    target.setItem(ACCESS_KEY, t.accessToken);
    target.setItem(REFRESH_KEY, t.refreshToken);
    target.setItem(REMEMBER_KEY, t.rememberMe ? '1' : '0');
}

export function getAccessToken(): string | null {
    return readFromEither(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
    return readFromEither(REFRESH_KEY);
}

export function getRememberMe(): boolean {
    return readFromEither(REMEMBER_KEY) === '1';
}

export function clearTokens(): void {
    if (!isBrowser()) return;
    for (const key of [ACCESS_KEY, REFRESH_KEY, REMEMBER_KEY]) {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
    }
}

/**
 * Replace ONLY the access token (refresh flow). Keeps the existing
 * rememberMe binding so a refresh doesn't demote the session's durability.
 */
export function setAccessToken(next: string): void {
    if (!isBrowser()) return;
    const remembered = getRememberMe();
    const target = store(remembered);
    if (!target) return;
    target.setItem(ACCESS_KEY, next);
}

import axios, {
    AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig,
} from 'axios';

import { env } from './env';
import {
    clearTokens, getAccessToken, getRefreshToken, setAccessToken,
} from './auth';

/**
 * Axios instance shared across the app.
 *
 * Interceptors:
 *   - Request: attach `Authorization: Bearer <access>` when a token exists.
 *   - Response: on 401, attempt a single refresh via POST /api/auth/refresh.
 *     Concurrent 401s share the same in-flight refresh promise so we never
 *     hit refresh twice in parallel.
 *   - Refresh failure: clear tokens and emit a custom `auth:logout` event
 *     so AuthGuard / stores can react without this module taking a hard
 *     dependency on them.
 *
 * Envelope: the backend wraps every response in `{ success, data, meta?, error?, code? }`.
 * Helpers below unwrap the `data` field so callers write `const { rows } =
 * await api.get<...>('/sales/customers')` without boilerplate.
 */

export type ApiEnvelope<T> = {
    success: boolean;
    data: T;
    meta?: { page: number; limit: number; total: number; totalPages: number };
    error?: string;
    code?: string;
    details?: unknown;
};

export const api: AxiosInstance = axios.create({
    baseURL: env.apiUrl,
    withCredentials: false,
    timeout: 30_000,
});

// ---------------------------------------------------------------------------
// REQUEST — attach access token
// ---------------------------------------------------------------------------
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ---------------------------------------------------------------------------
// RESPONSE — single-flight refresh on 401
// ---------------------------------------------------------------------------

// A sentinel flag on the Axios config so an already-retried request doesn't
// loop forever if the second call also returns 401.
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
        const res = await axios.post<ApiEnvelope<{ access_token: string }>>(
            `${env.apiUrl}/api/auth/refresh`,
            { refresh_token: refreshToken },
            { timeout: 15_000 },
        );
        const next = res.data?.data?.access_token;
        if (!next) return null;
        setAccessToken(next);
        return next;
    } catch {
        return null;
    }
}

function emitLogout(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('auth:logout'));
}

api.interceptors.response.use(
    (res: AxiosResponse) => res,
    async (err: AxiosError) => {
        const status = err.response?.status;
        const original = err.config as RetriableConfig | undefined;

        // Only 401s on an authenticated route trigger refresh. Skip the
        // auth endpoints themselves so a bad login doesn't recursively
        // trigger refresh.
        const url = original?.url || '';
        const isAuthEndpoint =
            url.startsWith('/api/auth/') || url.includes('/api/auth/');

        if (status !== 401 || !original || original._retried || isAuthEndpoint) {
            return Promise.reject(err);
        }

        original._retried = true;
        if (!refreshInFlight) {
            refreshInFlight = performRefresh().finally(() => {
                refreshInFlight = null;
            });
        }
        const nextToken = await refreshInFlight;
        if (!nextToken) {
            clearTokens();
            emitLogout();
            return Promise.reject(err);
        }

        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${nextToken}`;
        return api.request(original);
    },
);

// ---------------------------------------------------------------------------
// UNWRAPPERS
// ---------------------------------------------------------------------------

/**
 * GET the `data` field of the envelope. Throws if the envelope reports
 * `success:false` so the call site can rely on the returned type.
 */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const res = await api.get<ApiEnvelope<T>>(url, { params });
    if (!res.data.success) throw new Error(res.data.error || 'Request failed');
    return res.data.data;
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
    const res = await api.post<ApiEnvelope<T>>(url, body);
    if (!res.data.success) throw new Error(res.data.error || 'Request failed');
    return res.data.data;
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
    const res = await api.put<ApiEnvelope<T>>(url, body);
    if (!res.data.success) throw new Error(res.data.error || 'Request failed');
    return res.data.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
    const res = await api.delete<ApiEnvelope<T>>(url);
    if (!res.data.success) throw new Error(res.data.error || 'Request failed');
    return res.data.data;
}

/** Paginated GET — returns both rows and meta. */
export async function apiList<T>(
    url: string,
    params?: Record<string, unknown>,
): Promise<{ rows: T[]; meta: NonNullable<ApiEnvelope<T[]>['meta']> | null }> {
    const res = await api.get<ApiEnvelope<T[]>>(url, { params });
    if (!res.data.success) throw new Error(res.data.error || 'Request failed');
    return { rows: res.data.data, meta: res.data.meta || null };
}

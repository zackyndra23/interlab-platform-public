/**
 * Client-side env accessor. Only variables prefixed with `NEXT_PUBLIC_` are
 * available in the browser. The unprefixed fallbacks are kept so a misbuilt
 * deployment surfaces as an immediate runtime error instead of a silent
 * wrong-URL fetch.
 */

function required(name: string, value: string | undefined): string {
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

export const env = {
    appName: process.env.NEXT_PUBLIC_APP_NAME || 'Interlabs CRM',
    apiUrl: required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL),
    wsUrl: required('NEXT_PUBLIC_WS_URL', process.env.NEXT_PUBLIC_WS_URL),
    recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '',
} as const;

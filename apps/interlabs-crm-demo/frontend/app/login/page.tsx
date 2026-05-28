'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import ReCAPTCHA from 'react-google-recaptcha';

import { apiPost } from '@/lib/api';
import { setTokens } from '@/lib/auth';
import { env } from '@/lib/env';
import type { UserProfile } from '@/lib/rbac';
import type { LoginRequires2faResponse } from '@/lib/twofactor-types';
import { useAuthStore } from '@/stores/auth.store';
import { useThemeStore } from '@/stores/theme.store';
import { websocket } from '@/lib/websocket';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Checkbox } from '@/components/ui/Checkbox';

type LoginResponse = {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    refresh_expires_at?: string;
    user: UserProfile;
};

// Store the email in localStorage (so the field auto-fills on next visit) and
// ask the browser's password manager to save the password via the Credential
// Management API. Both are no-ops on browsers that don't support them and are
// strictly best-effort — we never block the login flow on these calls.
//
// Why awaited: Chrome's "Save password?" prompt is shown asynchronously by
// store(); if the page navigates before that microtask runs, Chrome can drop
// the prompt entirely. Awaiting (and the small post-success delay before
// router.replace) gives the prompt time to surface and stay visible.
async function rememberCredentials(email: string, password: string, rememberMe: boolean) {
    try {
        if (rememberMe) {
            window.localStorage.setItem('auth.remembered_email', email.trim());
        } else {
            window.localStorage.removeItem('auth.remembered_email');
        }
    } catch { /* localStorage may be blocked — non-fatal */ }

    if (!rememberMe) return;

    const W = window as unknown as {
        PasswordCredential?: new (init: { id: string; password: string; name?: string }) => Credential;
    };
    if (!W.PasswordCredential || typeof navigator.credentials?.store !== 'function') return;

    try {
        const cred = new W.PasswordCredential({
            id: email.trim(),
            password,
            // `name` is what Chrome's password manager UI displays alongside
            // the email; we use the email itself when display_name isn't
            // available at this code path (the 2FA pre-redirect call).
            name: email.trim(),
        });
        await navigator.credentials.store(cred);
    } catch (err) {
        // Surfaced to the console so an operator can see it in DevTools when
        // debugging "save prompt didn't appear" — the user-facing flow is
        // unaffected.
        // eslint-disable-next-line no-console
        console.warn('[auth] credentials.store failed:', err);
    }
}

const TAGLINE_WORDS = ['Precision', 'instruments.', 'Trusted', 'partnerships.'];
const COMPANY_VALUES = [
    'Commitment',
    'After Sales Service',
    'Good Relationship',
    'Teamwork',
    'Grade Satisfaction',
];

/**
 * Public login page. Split-screen brand experience — left panel carries
 * the company identity, right panel hosts the form. All auth logic is
 * unchanged; only the chrome around it has been redesigned.
 */
export default function LoginPage() {
    const router = useRouter();
    const setUser = useAuthStore((s) => s.setUser);
    const theme = useThemeStore((s) => s.theme);
    const toggleTheme = useThemeStore((s) => s.toggle);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loginSuccess, setLoginSuccess] = useState(false);

    const recaptchaRef = useRef<ReCAPTCHA | null>(null);
    const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);

    const recaptchaEnabled = Boolean(env.recaptchaSiteKey);

    // Guards the one-time orchestrated entry animation against SSR mismatch.
    // Doubles as the place we read "remembered email" out of localStorage so
    // the field auto-fills when a returning user lands here after logout.
    // Password is intentionally NOT stored client-side — that's the browser
    // password manager's job (we trigger it via navigator.credentials.store
    // on successful login below).
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
        try {
            const remembered = window.localStorage.getItem('auth.remembered_email');
            if (remembered) {
                setEmail(remembered);
                setRememberMe(true);
            }
        } catch { /* localStorage may be blocked — fall through silently */ }
    }, []);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (!email.trim() || !password) {
            setError('Email and password are required');
            return;
        }
        if (recaptchaEnabled && !recaptchaToken) {
            setError('The reCAPTCHA field is telling that you are a robot');
            return;
        }
        setSubmitting(true);
        try {
            const data = await apiPost<LoginResponse | LoginRequires2faResponse>('/api/auth/login', {
                email: email.trim(),
                password,
                recaptcha_token: recaptchaToken || '',
                remember_me: rememberMe,
            });

            // 2FA gate: if the server needs a second factor, redirect to the challenge page.
            // Save credentials BEFORE the redirect so 2FA users get the same
            // autofill experience as non-2FA users on their next visit. The
            // password is the user's actual password — completing 2FA later
            // doesn't change that.
            if ('requires_2fa' in data && data.requires_2fa) {
                await rememberCredentials(email, password, rememberMe);
                router.push(`/login/2fa?pending_token=${data.pending_token}&method=${data.method}`);
                return;
            }

            const loginData = data as LoginResponse;
            setTokens({
                accessToken: loginData.access_token,
                refreshToken: loginData.refresh_token,
                rememberMe,
            });
            setUser(loginData.user);
            websocket.connect();
            await rememberCredentials(email, password, rememberMe);

            toast.success(`Welcome back, ${loginData.user.display_name}`);
            // Brief success flash before navigating — 400ms to let the
            // right panel do its scale-up/fade-out before the redirect.
            setLoginSuccess(true);
            setTimeout(() => {
                router.replace('/dashboard');
            }, 420);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Login failed';
            setError(msg);
            recaptchaRef.current?.reset();
            setRecaptchaToken(null);
        } finally {
            setSubmitting(false);
        }
    }

    const fieldDelay = (i: number) => ({ animationDelay: `${900 + i * 80}ms` });
    const valueDelay = (i: number) => ({ animationDelay: `${700 + i * 120}ms` });
    const wordDelay = (i: number) => ({ animationDelay: `${500 + i * 40}ms` });

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background lg:flex-row">
            {/* ============================================================ */}
            {/* LEFT PANEL — Brand / Visual                                   */}
            {/* ============================================================ */}
            <aside
                className={`relative flex h-[220px] w-full shrink-0 overflow-hidden lg:h-auto lg:w-[55%] ${
                    mounted ? 'animate-panel-left' : 'opacity-0'
                }`}
                style={{
                    backgroundImage: 'url(/login-bg.jpg)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: 'hsl(var(--login-panel-bg))',
                }}
            >
                {/* --- Dark cinematic overlay (sits above the photo, below content) --- */}
                <div
                    aria-hidden="true"
                    className="absolute inset-0 z-[1]"
                    style={{
                        background:
                            'linear-gradient(135deg, hsl(220 40% 5% / 0.75) 0%, hsl(348 60% 10% / 0.60) 100%)',
                    }}
                />

                {/* --- Background: SVG grid overlay --- */}
                <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-[2] h-full w-full animate-grid-shimmer"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
                            <path
                                d="M 48 0 L 0 0 0 48"
                                fill="none"
                                stroke="hsl(var(--login-grid-line))"
                                strokeWidth="1"
                            />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#login-grid)" />
                </svg>

                {/* --- Background: slow-drifting color blobs (muted — photo carries the richness) --- */}
                <div
                    aria-hidden="true"
                    className="animate-blob pointer-events-none absolute -left-24 -top-24 z-[2] h-[480px] w-[480px] rounded-full blur-3xl"
                    style={{ backgroundColor: 'hsl(var(--brand-red) / 0.08)' }}
                />
                <div
                    aria-hidden="true"
                    className="animate-blob-alt pointer-events-none absolute -bottom-32 right-[-6rem] z-[2] h-[520px] w-[520px] rounded-full blur-3xl"
                    style={{ backgroundColor: 'hsl(215 90% 50% / 0.08)' }}
                />
                <div
                    aria-hidden="true"
                    className="animate-blob pointer-events-none absolute left-1/3 top-1/2 z-[2] h-[360px] w-[360px] rounded-full blur-3xl"
                    style={{ backgroundColor: 'hsl(220 30% 8% / 0.35)', animationDelay: '-7s' }}
                />

                {/* --- Diagonal brand-red sweep (very subtle) --- */}
                <div
                    aria-hidden="true"
                    className="animate-sweep pointer-events-none absolute -top-1/2 left-0 z-[2] h-[200%] w-2/3 opacity-[0.05]"
                    style={{
                        background:
                            'linear-gradient(90deg, transparent 0%, hsl(var(--brand-red)) 50%, transparent 100%)',
                    }}
                />

                {/* --- Hexagonal lab motifs (floating) --- */}
                <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute right-10 top-16 z-[2] h-28 w-28 opacity-[0.08]"
                    viewBox="0 0 100 100"
                >
                    <polygon
                        points="50,5 95,27 95,73 50,95 5,73 5,27"
                        fill="none"
                        stroke="white"
                        strokeWidth="1"
                    />
                    <polygon
                        points="50,22 80,37 80,63 50,78 20,63 20,37"
                        fill="none"
                        stroke="white"
                        strokeWidth="0.8"
                    />
                </svg>
                <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-24 left-14 z-[2] h-20 w-20 opacity-[0.07]"
                    viewBox="0 0 100 100"
                >
                    <polygon
                        points="50,5 95,27 95,73 50,95 5,73 5,27"
                        fill="none"
                        stroke="white"
                        strokeWidth="1"
                    />
                </svg>

                {/* --- Foreground content (always above photo + overlays) --- */}
                <div className="relative z-10 flex h-full w-full flex-col justify-between p-6 text-white lg:p-14">
                    {/* Top — brand mark */}
                    <div className="flex items-center gap-3">
                        <div
                            className={`flex items-center justify-center rounded-2xl bg-white/95 p-2 shadow-xl ring-1 ring-white/30 ${
                                mounted ? 'animate-logo-drop' : 'opacity-0'
                            }`}
                            style={{ animationDelay: '300ms' }}
                        >
                            <Image
                                src="/company-logo.jpeg"
                                alt={env.appName}
                                width={56}
                                height={56}
                                priority
                                className="h-12 w-12 rounded-lg object-contain lg:h-14 lg:w-14"
                            />
                        </div>
                        <div className="hidden lg:block">
                            <div className="text-xs uppercase tracking-[0.2em] text-white/60">
                                Interlab Sentra Solutions
                            </div>
                            <div className="text-sm font-medium text-white/85">Operations Hub</div>
                        </div>
                    </div>

                    {/* Middle — headline + values (hidden on mobile header) */}
                    <div className="hidden flex-col gap-8 lg:flex">
                        <div>
                            <h1
                                className="text-4xl font-semibold leading-tight text-white xl:text-5xl"
                                style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
                            >
                                {TAGLINE_WORDS.map((word, i) => (
                                    <span
                                        key={`${word}-${i}`}
                                        className={`mr-3 inline-block ${
                                            mounted ? 'animate-stagger' : 'opacity-0'
                                        }`}
                                        style={wordDelay(i)}
                                    >
                                        {word}
                                    </span>
                                ))}
                            </h1>
                            <p
                                className={`mt-5 max-w-md text-base leading-relaxed text-white/65 ${
                                    mounted ? 'animate-stagger' : 'opacity-0'
                                }`}
                                style={{ animationDelay: '650ms' }}
                            >
                                Operations hub for Indonesia&apos;s leading laboratory solutions provider.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {COMPANY_VALUES.map((value, i) => (
                                <span
                                    key={value}
                                    className={`rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium tracking-wide text-white/75 backdrop-blur ${
                                        mounted ? 'animate-stagger' : 'opacity-0'
                                    }`}
                                    style={valueDelay(i)}
                                >
                                    {value}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Mobile compact tagline */}
                    <div className="flex flex-col items-start gap-1 lg:hidden">
                        <h1
                            className="text-2xl font-semibold leading-tight text-white"
                            style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
                        >
                            Precision instruments.
                        </h1>
                        <p className="text-sm text-white/60">
                            Interlab Operations Hub
                        </p>
                    </div>

                    {/* Bottom — footnote */}
                    <div
                        className={`hidden items-center gap-3 text-[11px] uppercase tracking-[0.25em] text-white/40 lg:flex ${
                            mounted ? 'animate-stagger' : 'opacity-0'
                        }`}
                        style={{ animationDelay: '1400ms' }}
                    >
                        <span>Est. 2005</span>
                        <span className="h-1 w-1 rounded-full bg-white/30" />
                        <span>Oil &amp; Gas</span>
                        <span className="h-1 w-1 rounded-full bg-white/30" />
                        <span>Petrochemical</span>
                        <span className="h-1 w-1 rounded-full bg-white/30" />
                        <span>Mining</span>
                        <span className="h-1 w-1 rounded-full bg-white/30" />
                        <span>Power Generation</span>
                    </div>
                </div>

                {/* Right-edge fade into form panel (desktop only) */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 top-0 z-[2] hidden h-full w-24 lg:block"
                    style={{
                        background:
                            'linear-gradient(90deg, transparent 0%, hsl(var(--background) / 0.4) 100%)',
                    }}
                />
            </aside>

            {/* ============================================================ */}
            {/* RIGHT PANEL — Login Form                                      */}
            {/* ============================================================ */}
            <main
                className={`relative flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-[45%] lg:px-10 ${
                    mounted ? 'animate-panel-right' : 'opacity-0'
                } ${loginSuccess ? 'animate-success-exit' : ''}`}
            >
                {/* Theme toggle — top right */}
                <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                    className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground lg:right-6 lg:top-6"
                >
                    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>

                {/* Glass form card */}
                <div className="login-glass relative w-full max-w-sm rounded-2xl p-8 shadow-2xl shadow-black/10 sm:p-10">
                    <div
                        className={`mb-8 flex flex-col items-center text-center ${
                            mounted ? 'animate-stagger' : 'opacity-0'
                        }`}
                        style={{ animationDelay: '800ms' }}
                    >
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-white p-2 shadow-md ring-1 ring-black/5">
                            <Image
                                src="/company-logo.jpeg"
                                alt={env.appName}
                                width={56}
                                height={56}
                                priority
                                className="h-12 w-12 rounded-md object-contain"
                            />
                        </div>
                        <h2
                            className="text-xl font-semibold tracking-tight text-foreground"
                            style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
                        >
                            Welcome back
                        </h2>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                            Sign in to access your operations hub.
                        </p>
                    </div>

                    <form className="space-y-5" onSubmit={onSubmit} noValidate>
                        {/* Email */}
                        <div
                            className={`space-y-1.5 ${mounted ? 'animate-stagger' : 'opacity-0'}`}
                            style={fieldDelay(0)}
                        >
                            <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Email
                            </Label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@interlab-portal.com"
                                aria-label="Email address"
                                className="login-input h-11"
                                required
                            />
                        </div>

                        {/* Password */}
                        <div
                            className={`space-y-1.5 ${mounted ? 'animate-stagger' : 'opacity-0'}`}
                            style={fieldDelay(1)}
                        >
                            <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Password
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    aria-label="Password"
                                    placeholder="••••••••"
                                    className="login-input h-11 pr-11"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Row: remember me + forgot password */}
                        <div
                            className={`flex items-center justify-between ${
                                mounted ? 'animate-stagger' : 'opacity-0'
                            }`}
                            style={fieldDelay(2)}
                        >
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                                <Checkbox
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    aria-label="Remember me"
                                    style={{ accentColor: '#C8102E' }}
                                />
                                Remember me
                            </label>
                            <button
                                type="button"
                                className="text-sm font-medium text-muted-foreground transition-colors hover:text-[hsl(var(--brand-red))] hover:underline underline-offset-4"
                                onClick={() => router.push('/forgot-password')}
                            >
                                Forgot password?
                            </button>
                        </div>

                        {/* reCAPTCHA */}
                        {recaptchaEnabled && (
                            <div
                                className={`flex justify-center ${
                                    mounted ? 'animate-stagger' : 'opacity-0'
                                }`}
                                style={fieldDelay(3)}
                            >
                                <ReCAPTCHA
                                    ref={recaptchaRef}
                                    sitekey={env.recaptchaSiteKey}
                                    onChange={(token) => setRecaptchaToken(token)}
                                    onExpired={() => setRecaptchaToken(null)}
                                    theme={theme}
                                    hl="en"
                                />
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <p
                                role="alert"
                                className="animate-slide-down overflow-hidden rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            >
                                {error}
                            </p>
                        )}

                        {/* Divider */}
                        <div
                            className={`border-t border-border/40 ${
                                mounted ? 'animate-stagger' : 'opacity-0'
                            }`}
                            style={fieldDelay(4)}
                        />

                        {/* Submit */}
                        <Button
                            type="submit"
                            disabled={submitting || loginSuccess}
                            aria-label="Sign in"
                            className={`btn-brand h-11 w-full rounded-md text-sm font-semibold tracking-wide ${
                                mounted ? 'animate-pulse-in' : 'opacity-0'
                            } ${loginSuccess ? 'btn-brand-success' : ''}`}
                            style={{ animationDelay: '1100ms' }}
                        >
                            {loginSuccess ? (
                                <span className="flex items-center gap-2">
                                    <Check size={16} />
                                    Signed in
                                </span>
                            ) : submitting ? (
                                <span className="flex items-center gap-2">
                                    <span className="login-spinner" />
                                    Signing in…
                                </span>
                            ) : (
                                'Sign in'
                            )}
                        </Button>

                        <p
                            className={`pt-1 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70 ${
                                mounted ? 'animate-stagger' : 'opacity-0'
                            }`}
                            style={{ animationDelay: '1300ms' }}
                        >
                            Authorized personnel only
                        </p>
                    </form>
                </div>
            </main>
        </div>
    );
}

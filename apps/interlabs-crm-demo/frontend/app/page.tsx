import { redirect } from 'next/navigation';

/**
 * Root route is a redirector. Logged-in users land on /dashboard; anonymous
 * users land on /login. Because token storage is client-side (localStorage
 * or sessionStorage) we can't read it during SSR — so the redirect
 * optimistically sends to /dashboard and the AuthGuard there re-routes
 * anonymous sessions to /login on the client.
 */
export default function Home() {
    redirect('/dashboard');
}

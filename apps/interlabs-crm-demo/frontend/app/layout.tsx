import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { ThemeBootstrap } from '@/components/layout/ThemeBootstrap';

const playfair = Playfair_Display({
    subsets: ['latin'],
    variable: '--font-display',
    display: 'swap',
});

const dmSans = DM_Sans({
    subsets: ['latin'],
    variable: '--font-body',
    display: 'swap',
});

export const metadata: Metadata = {
    title: 'Interlabs CRM',
    description: 'Interlabs internal operations hub',
};

/**
 * Root layout. We intentionally put `data-theme` handling in a tiny client
 * component (ThemeBootstrap) instead of inlining a <script> — keeps SSR
 * output deterministic, and the flash-of-wrong-theme is bounded to a single
 * paint. If that becomes visible in production, swap to the classic inline
 * <script> trick that reads localStorage before React hydrates.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning className={`${playfair.variable} ${dmSans.variable}`}>
            <body className="min-h-screen antialiased">
                <ThemeBootstrap />
                {children}
                <Toaster richColors position="top-right" closeButton />
            </body>
        </html>
    );
}

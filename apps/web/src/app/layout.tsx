import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { Toaster, UIProvider } from '@erp/ui';
import { publicEnv } from '@/config/env';
import './globals.css';

/**
 * الخط العربي الأساسي.
 * IBM Plex Sans Arabic: عائلة مفتوحة المصدر بأوزان متعددة وقراءة ممتازة
 * في الجداول الكثيفة — وهو الاستخدام الغالب في هذا النظام.
 */
const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: publicEnv.NEXT_PUBLIC_APP_NAME,
    template: `%s · ${publicEnv.NEXT_PUBLIC_APP_NAME}`,
  },
  description: 'منصة مركزية لإدارة الفروع والعمليات',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e293b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={arabicFont.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <UIProvider dir="rtl">
          {children}
          <Toaster />
        </UIProvider>
      </body>
    </html>
  );
}

import Link from 'next/link';
import { Building2, LogIn } from 'lucide-react';
import { Button } from '@erp/ui';
import { publicEnv } from '@/config/env';

/**
 * تخطيط الموقع العام.
 *
 * ⚠️ لا يقرأ من قاعدة البيانات ولا يستدعي جلسة — كل صفحة تجلب بياناتها بدور `anon`.
 */
const NAV = [
  { href: '/services', label: 'الخدمات' },
  { href: '/branches', label: 'الفروع' },
  { href: '/providers', label: 'الأطباء' },
  { href: '/contact', label: 'تواصل معنا' },
] as const;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const appName = publicEnv.NEXT_PUBLIC_APP_NAME;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 lg:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="size-5" aria-hidden />
            </span>
            <span className="hidden truncate sm:inline">{appName}</span>
          </Link>

          <nav className="ms-auto hidden items-center gap-1 md:flex" aria-label="أقسام الموقع">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2 md:ms-0">
            <Button asChild size="sm">
              <Link href="/book">احجز موعدًا</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" title="دخول الموظفين">
              <Link href="/login">
                <LogIn aria-hidden />
                <span className="hidden sm:inline">دخول الموظفين</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground lg:flex-row lg:items-center lg:px-6">
          <p>© {new Date().getFullYear()} {appName}</p>
          <nav className="flex flex-wrap gap-4 lg:ms-auto" aria-label="روابط قانونية">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ))}
            <Link href="/login" className="hover:text-foreground hover:underline">
              دخول الموظفين
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

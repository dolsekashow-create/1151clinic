import Image from 'next/image';
import Link from 'next/link';
import { CalendarPlus, LogIn, Menu } from 'lucide-react';
import { Button } from '@erp/ui';
import { publicEnv } from '@/config/env';

/**
 * تخطيط الموقع العام — عيادات التجميل.
 *
 * ⚠️ `theme-clinic` تُبدّل الرموز اللونية لهذا الفرع من الشجرة وحده. لوحة
 *    الإدارة تبقى بسمتها الزرقاء، ولا مكوّن يعرف أن السمة تغيّرت.
 * ⚠️ لا يقرأ من قاعدة البيانات ولا يستدعي جلسة — كل صفحة تجلب بياناتها بدور `anon`.
 * ⚠️ روابط القائمة **مسارات موجودة فعلًا فقط**. إضافة «أحدث الأخبار» أو
 *    «الأسئلة الشائعة» تعني روابط تعطي 404 — والصفحة الجميلة التي لا تعمل
 *    أسوأ من صفحة أبسط تعمل.
 */
const NAV = [
  { href: '/', label: 'الرئيسية' },
  { href: '/services', label: 'الخدمات' },
  { href: '/branches', label: 'عياداتنا' },
  { href: '/providers', label: 'الأطباء' },
  { href: '/contact', label: 'تواصل معنا' },
] as const;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const appName = publicEnv.NEXT_PUBLIC_APP_NAME;

  return (
    <div className="theme-clinic flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-4 px-4 lg:px-8">
          {/* الشعار — يمين في RTL */}
          <Link href="/" className="flex shrink-0 items-center" aria-label="14Clinic — الصفحة الرئيسية">
            <Image
              src="/logo.png"
              alt="14Clinic — عيادات التجميل"
              width={600}
              height={199}
              priority
              className="h-10 w-auto sm:h-12"
            />
          </Link>

          <nav className="mx-auto hidden items-center gap-1 lg:flex" aria-label="أقسام الموقع">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-clinic-blush hover:text-[var(--clinic-rose)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2 lg:ms-0">
            <Button asChild className="rounded-full bg-clinic-ink px-5 hover:opacity-90">
              <Link href="/book">
                <CalendarPlus aria-hidden />
                <span className="hidden sm:inline">احجز موعدك الآن</span>
                <span className="sm:hidden">احجز</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" title="دخول الموظفين">
              <Link href="/login" aria-label="دخول الموظفين">
                <LogIn aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        {/* شريط تنقّل الجوال — القائمة الكاملة لا تتسع في الترويسة */}
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 lg:hidden"
          aria-label="أقسام الموقع"
        >
          <Menu className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-clinic-blush hover:text-[var(--clinic-rose)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/60 bg-clinic-blush">
        <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-sm">
              <Image
                src="/logo.png"
                alt="14Clinic — عيادات التجميل"
                width={600}
                height={199}
                className="h-10 w-auto"
              />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                خدمات تجميلية بإشراف نخبة من الأطباء المتخصصين، وبأعلى معايير الأمان والجودة.
              </p>
            </div>

            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="روابط الموقع">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-[var(--clinic-rose)]"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/login"
                className="text-muted-foreground transition-colors hover:text-[var(--clinic-rose)]"
              >
                دخول الموظفين
              </Link>
            </nav>
          </div>

          <p className="mt-8 border-t border-border/60 pt-6 text-xs text-muted-foreground">
            © {new Date().getFullYear()} {appName}. جميع الحقوق محفوظة.
          </p>
        </div>
      </footer>
    </div>
  );
}

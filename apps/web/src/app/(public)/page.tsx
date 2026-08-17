import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarPlus, MapPin, Sparkles, Stethoscope } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@erp/ui';
import { publicEnv } from '@/config/env';
import { getPublicSummary } from '@/modules/public-site/repository';

export const metadata: Metadata = {
  title: 'الرئيسية',
  robots: { index: false, follow: false },
};

/**
 * الصفحة الرئيسية العامة.
 *
 * ⚠️ العدّادات تُقرأ بدور `anon` فتساوي حتمًا ما يراه الزائر: إن لم يُنشَر شيء
 *    فالأرقام أصفار والصفحة تقول ذلك بدل ادّعاء بيانات غير منشورة.
 * ⚠️ لا زر حجز هنا: الحجز العام في المرحلة 6، ولا نضع روابط لمسارات غير موجودة.
 */
export const dynamic = 'force-dynamic';

const SECTIONS = [
  {
    href: '/services',
    icon: Sparkles,
    title: 'الخدمات',
    description: 'تعرّف على الخدمات المتوفرة في مراكزنا.',
    countKey: 'services',
  },
  {
    href: '/branches',
    icon: MapPin,
    title: 'الفروع',
    description: 'مواقع الفروع وبيانات التواصل.',
    countKey: 'branches',
  },
  {
    href: '/providers',
    icon: Stethoscope,
    title: 'الأطباء',
    description: 'نخبة من الأطباء وأخصائيي الرعاية.',
    countKey: 'providers',
  },
] as const;

export default async function PublicHomePage() {
  const summary = await getPublicSummary();
  const hasContent = summary.branches + summary.services + summary.providers > 0;

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center lg:px-6 lg:py-24">
          <h1 className="mx-auto max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {publicEnv.NEXT_PUBLIC_APP_NAME}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            {summary.cities.length > 0
              ? `رعاية صحية قريبة منك عبر ${summary.branches} فرعًا في ${summary.cities.join('، ')}.`
              : 'رعاية صحية قريبة منك عبر شبكة فروعنا.'}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {/* الحجز متاح فقط حين يوجد فرع منشور — وإلا فالزر يقود إلى شاشة فارغة */}
            {summary.branches > 0 ? (
              <Button asChild size="lg">
                <Link href="/book">
                  <CalendarPlus aria-hidden />
                  احجز موعدًا
                </Link>
              </Button>
            ) : null}
            <Button asChild size="lg" variant={summary.branches > 0 ? 'outline' : 'primary'}>
              <Link href="/branches">تعرّف على الفروع</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/contact">تواصل معنا</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 lg:px-6" aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="sr-only">
          أقسام الموقع
        </h2>
        {hasContent ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const count = summary[section.countKey];
              return (
                <Card key={section.href}>
                  <CardHeader>
                    <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-5">
                      <Icon aria-hidden />
                    </span>
                    <CardTitle>
                      {section.title}
                      {count > 0 ? (
                        <span className="ms-2 text-sm font-normal text-muted-foreground">{count}</span>
                      ) : null}
                    </CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild variant="outline" size="sm" disabled={count === 0}>
                      <Link href={section.href}>عرض التفاصيل</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="لا يوجد محتوى منشور حاليًا"
            description="يتحكّم مالك المنشأة في ما يظهر هنا من لوحة الإدارة عبر نشر الفروع والخدمات والأطباء."
          />
        )}
      </section>
    </>
  );
}

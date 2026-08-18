import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Clock,
  MapPin,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { Button, EmptyState } from '@erp/ui';
import { getPublicSummary, listPublicServices } from '@/modules/public-site/repository';

export const metadata: Metadata = {
  title: 'الرئيسية',
  description: 'خدمات تجميلية بإشراف نخبة من الأطباء المتخصصين. احجز موعدك في دقائق.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * الصفحة الرئيسية — عيادات التجميل.
 *
 * ⚠️ الخدمات المعروضة تأتي من **قاعدة البيانات** بدور `anon`، لا من قائمة
 *    ثابتة في الكود. ما لم يُنشره صاحب المنشأة لا يظهر هنا، ولو كان القسم
 *    يبدو فارغًا — عرض خدمات وهمية «للشكل» يعني موقعًا يَعِد بما لا يوجد.
 * ⚠️ لا أسعار في أي موضع: P-14 معلّقة.
 */
export default async function PublicHomePage() {
  const [summary, services] = await Promise.all([getPublicSummary(), listPublicServices()]);
  const hasContent = summary.branches + summary.services + summary.providers > 0;

  return (
    <>
      <HeroSection cities={summary.cities} branches={summary.branches} canBook={summary.branches > 0} />
      <ServicesSection services={services.slice(0, 6)} total={summary.services} />
      <BookingStepsSection canBook={summary.branches > 0} />
      <TrustSection summary={summary} hasContent={hasContent} />
    </>
  );
}

/* --------------------------------- الهيرو -------------------------------- */

function HeroSection({
  cities,
  branches,
  canBook,
}: {
  cities: readonly string[];
  branches: number;
  canBook: boolean;
}) {
  return (
    <section className="relative overflow-hidden bg-clinic-gradient">
      {/* زخرفة ناعمة — لا تحمل معنى فتُخفى عن قارئات الشاشة */}
      <div
        aria-hidden
        className="pointer-events-none absolute -start-24 -top-24 size-72 rounded-full bg-[var(--clinic-rose)]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -end-16 size-80 rounded-full bg-[var(--clinic-rose)]/10 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 lg:grid-cols-2 lg:px-8 lg:py-24">
        <div className="text-center lg:text-start">
          <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-4 py-1.5 text-xs font-medium text-[var(--clinic-rose)] ring-1 ring-[var(--clinic-rose)]/20">
            <Sparkles className="size-3.5" aria-hidden />
            {branches > 0 && cities.length > 0
              ? `${branches} عيادة في ${cities.slice(0, 3).join('، ')}`
              : 'عيادات التجميل'}
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight text-clinic-ink sm:text-5xl">
            جمالك يستحق
            <span className="mt-1 block text-[var(--clinic-rose)]">خبرة تهتم بك</span>
          </h1>

          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted-foreground lg:mx-0">
            نقدّم لك أحدث خدمات التجميل بإشراف نخبة من الأطباء المتخصصين، وبأعلى معايير الأمان
            والجودة.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            {canBook ? (
              <Button asChild size="lg" className="rounded-full bg-clinic-ink px-7 hover:opacity-90">
                <Link href="/book">
                  <CalendarPlus aria-hidden />
                  احجز موعدك الآن
                </Link>
              </Button>
            ) : null}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-border bg-background px-7"
            >
              <Link href="/branches">
                تعرّف على عياداتنا
                <ArrowLeft aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        {/* لوحة بصرية بلا صورة خارجية — لا نعتمد على أصل غير موجود في المستودع */}
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--clinic-blush)] via-background to-[var(--clinic-rose)]/15 ring-1 ring-border/60">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <span className="flex size-20 items-center justify-center rounded-full bg-background/80 text-[var(--clinic-rose)] shadow-sm">
                <Sparkles className="size-9" aria-hidden />
              </span>
              <p className="text-lg font-semibold text-clinic-ink">رعاية تجميلية متكاملة</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                من الاستشارة الأولى حتى المتابعة بعد الجلسة.
              </p>
            </div>
          </div>

          <div className="absolute -bottom-5 start-4 flex items-center gap-3 rounded-2xl bg-background px-4 py-3 shadow-lg ring-1 ring-border/60 lg:start-8">
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--clinic-rose)]/10 text-[var(--clinic-rose)]">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <span className="text-xs">
              <span className="block font-semibold text-clinic-ink">أطباء معتمدون</span>
              <span className="block text-muted-foreground">وبروتوكولات أمان صارمة</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- الخدمات -------------------------------- */

/**
 * أيقونة لكل خدمة — تُشتق من اسمها.
 * ⚠️ التحسين بصري بحت: لا يغيّر أي بيانات ولا يفترض وجود خدمة بعينها. الخدمة
 *    التي لا يطابق اسمها شيئًا تأخذ الأيقونة العامة.
 */
function serviceIcon(name: string) {
  if (/ليزر|شعر/.test(name)) return Sparkles;
  if (/حقن|فيلر|بوتوكس/.test(name)) return Stethoscope;
  if (/بشرة|وجه|جلد/.test(name)) return UserRound;
  return Sparkles;
}

function ServicesSection({
  services,
  total,
}: {
  services: Awaited<ReturnType<typeof listPublicServices>>;
  total: number;
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 lg:px-8 lg:py-20" aria-labelledby="services-heading">
      <div className="text-center">
        <h2 id="services-heading" className="text-3xl font-bold tracking-tight text-clinic-ink">
          خدماتنا التجميلية
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          مجموعة متكاملة من خدمات التجميل بإشراف نخبة من الأطباء المتخصصين.
        </p>
      </div>

      {services.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="لا توجد خدمات منشورة حاليًا"
            description="تظهر الخدمات هنا فور نشرها من لوحة الإدارة."
          />
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = serviceIcon(service.nameAr);
              return (
                <article
                  key={service.id}
                  className="group rounded-2xl border border-border/70 bg-card p-6 text-center transition-all hover:-translate-y-0.5 hover:border-[var(--clinic-rose)]/40 hover:shadow-lg"
                >
                  <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--clinic-rose)]/10 text-[var(--clinic-rose)] transition-colors group-hover:bg-[var(--clinic-rose)] group-hover:text-white">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold text-clinic-ink">{service.nameAr}</h3>
                  {service.description ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {service.description}
                    </p>
                  ) : null}
                  {service.durationMinutes ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3.5" aria-hidden />
                      {service.durationMinutes} دقيقة
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>

          {total > services.length ? (
            <div className="mt-8 text-center">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/services">
                  عرض كل الخدمات ({total})
                  <ArrowLeft aria-hidden />
                </Link>
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ----------------------------- خطوات الحجز ------------------------------- */

const STEPS = [
  { icon: MapPin, title: 'اختر العيادة', text: 'اختر العيادة الأقرب إليك من بين عياداتنا المتاحة.' },
  { icon: Sparkles, title: 'اختر الخدمة', text: 'اختر الخدمة التجميلية التي تناسب احتياجك.' },
  { icon: UserRound, title: 'اختر الطبيب', text: 'اختر من الأطباء المتاحين لهذه الخدمة.' },
  { icon: CalendarCheck, title: 'اختر الموعد', text: 'اختر اليوم والوقت المناسب لك من الأوقات المتاحة.' },
  { icon: ClipboardList, title: 'أدخل بياناتك', text: 'اسمك ورقم جوالك فقط — بلا إنشاء حساب.' },
] as const;

function BookingStepsSection({ canBook }: { canBook: boolean }) {
  return (
    <section className="bg-clinic-gradient py-16 lg:py-20" aria-labelledby="steps-heading">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="text-center">
          <h2 id="steps-heading" className="text-3xl font-bold tracking-tight text-clinic-ink">
            كيف تحجز موعدك؟
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            خمس خطوات سهلة لحجز موعدك في دقائق، بلا تسجيل دخول.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative text-center">
                <span className="relative mx-auto flex size-16 items-center justify-center rounded-full bg-background text-[var(--clinic-rose)] shadow-sm ring-1 ring-border/60">
                  <Icon className="size-6" aria-hidden />
                  <span className="absolute -top-1.5 -end-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--clinic-rose)] text-[11px] font-bold text-white">
                    {index + 1}
                  </span>
                </span>
                <h3 className="mt-4 font-semibold text-clinic-ink">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
              </li>
            );
          })}
        </ol>

        {canBook ? (
          <div className="mt-12 text-center">
            <Button asChild size="lg" className="rounded-full bg-clinic-ink px-8 hover:opacity-90">
              <Link href="/book">
                <CalendarPlus aria-hidden />
                ابدأ الحجز الآن
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------- الأرقام -------------------------------- */

function TrustSection({
  summary,
  hasContent,
}: {
  summary: Awaited<ReturnType<typeof getPublicSummary>>;
  hasContent: boolean;
}) {
  if (!hasContent) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
        <EmptyState
          title="لا يوجد محتوى منشور حاليًا"
          description="يتحكّم مالك المنشأة فيما يظهر هنا من لوحة الإدارة عبر نشر العيادات والخدمات والأطباء."
        />
      </section>
    );
  }

  const stats = [
    { value: summary.branches, label: 'عيادة', href: '/branches', icon: MapPin },
    { value: summary.services, label: 'خدمة تجميلية', href: '/services', icon: Sparkles },
    { value: summary.providers, label: 'طبيب متخصص', href: '/providers', icon: Stethoscope },
  ] as const;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 lg:px-8 lg:py-20" aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="sr-only">
        أرقام المنشأة
      </h2>
      <div className="grid gap-5 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-[var(--clinic-rose)]/40 hover:shadow-lg"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--clinic-rose)]/10 text-[var(--clinic-rose)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-2xl font-bold tabular-nums text-clinic-ink">
                  {stat.value}
                </span>
                <span className="block text-sm text-muted-foreground">{stat.label}</span>
              </span>
              <ArrowLeft
                className="ms-auto size-4 text-muted-foreground transition-transform group-hover:-translate-x-1"
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Clock, MapPin, Sparkles, Stethoscope } from 'lucide-react';
import { Alert, Button, Card, CardContent, Field, Input, Textarea } from '@erp/ui';
import type { PublicBranch } from '../repository';
import type { PublicOption } from '../booking';

/** يطابق `HONEYPOT_FIELD` في طبقة الحد من المعدّل. */
const HONEYPOT_FIELD = 'website_url';

const STEPS = ['العيادة', 'الخدمة', 'الطبيب', 'اليوم', 'الوقت', 'بياناتك', 'تأكيد'] as const;

interface Selection {
  branch: PublicBranch | null;
  service: PublicOption | null;
  provider: PublicOption | null;
  date: string;
  slot: string;
}

const EMPTY: Selection = { branch: null, service: null, provider: null, date: '', slot: '' };

/**
 * معالج الحجز العام.
 *
 * ⚠️ **لا يُحسب أي وقت هنا.** الأوقات تأتي من `/api/public/availability` التي
 *    تستدعي محرّك قاعدة البيانات. أي حساب موازٍ في المتصفح كان سيعرض وقتًا
 *    يرفضه الحجز — والمستخدم هو من يدفع ثمن التناقض.
 * ⚠️ لا أسعار ولا دفع ولا عربون في أي خطوة.
 * ⚠️ مفتاح عدم التكرار يُولَّد **مرة واحدة** عند بدء التأكيد ويثبت عبر إعادة
 *    المحاولة: توليده مع كل ضغطة يُلغي الغرض منه.
 */
export function BookingWizard({ branches }: { branches: readonly PublicBranch[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<Selection>(EMPTY);

  const [services, setServices] = useState<readonly PublicOption[]>([]);
  const [providers, setProviders] = useState<readonly PublicOption[]>([]);
  const [slots, setSlots] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idempotencyKey = useRef<string>('');

  const go = (next: number) => {
    setError(null);
    setStep(next);
  };

  /* ----------------------------- تحميل الخيارات ---------------------------- */

  const loadServices = useCallback(async (branchId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/options?branch_id=${branchId}`);
      const body = await res.json();
      setServices(res.ok ? body.services : []);
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async (branchId: string, serviceId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/options?branch_id=${branchId}&service_id=${serviceId}`);
      const body = await res.json();
      setProviders(res.ok ? body.providers : []);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sel.branch || !sel.service || !sel.provider || !sel.date) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/public/availability?branch_id=${sel.branch.id}&service_id=${sel.service.id}` +
        `&provider_id=${sel.provider.id}&date=${sel.date}`,
    )
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSlots([]);
          setError(body.error ?? 'تعذّر جلب الأوقات المتاحة');
          return;
        }
        setSlots(body.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('تعذّر الاتصال، تحقّق من الشبكة وحاول مرة أخرى');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sel.branch, sel.service, sel.provider, sel.date]);

  /* -------------------------------- الإرسال -------------------------------- */

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // حارس أول ضد النقر المزدوج
    setError(null);

    const fd = new FormData(event.currentTarget);
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/booking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branch_id: sel.branch?.id,
          service_id: sel.service?.id,
          provider_id: sel.provider?.id,
          slot: sel.slot,
          full_name: String(fd.get('full_name') ?? ''),
          phone: String(fd.get('phone') ?? ''),
          email: String(fd.get('email') ?? ''),
          notes: String(fd.get('notes') ?? ''),
          idempotency_key: idempotencyKey.current,
          [HONEYPOT_FIELD]: String(fd.get(HONEYPOT_FIELD) ?? ''),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'حدث خطأ أثناء إنشاء الحجز، حاول مرة أخرى');
        // الوقت قد يكون التُقط ⇒ نُعيد المستخدم لاختيار وقت آخر
        if (res.status === 409) {
          setSel((prev) => ({ ...prev, slot: '' }));
          setStep(4);
        }
        return;
      }
      router.push(`/book/confirmation/${encodeURIComponent(body.reference_no)}`);
    } catch {
      setError('تعذّر الاتصال، تحقّق من الشبكة وحاول مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  }

  /* -------------------------------- العرض --------------------------------- */

  const nextDays = useMemo(() => buildNextDays(21), []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-clinic-ink">احجز موعدك التجميلي</h1>
      <p className="mt-2 text-muted-foreground">
        بلا تسجيل دخول. اختر العيادة والخدمة والطبيب والوقت المناسب لك.
      </p>

      <Stepper current={step} />

      {error ? (
        <Alert variant="danger" title="تعذّر المتابعة" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6">
        {step === 0 ? (
          <ChoiceList
            title="اختر العيادة"
            icon={<MapPin aria-hidden />}
            empty="لا توجد عيادات متاحة للحجز حاليًا."
            items={branches.map((b) => ({
              id: b.id,
              nameAr: b.nameAr,
              subtitle: [b.city, b.phone].filter(Boolean).join(' · ') || null,
            }))}
            onSelect={(item) => {
              const branch = branches.find((b) => b.id === item.id) ?? null;
              setSel({ ...EMPTY, branch });
              setServices([]);
              setProviders([]);
              if (branch) void loadServices(branch.id);
              go(1);
            }}
          />
        ) : null}

        {step === 1 ? (
          <ChoiceList
            title="اختر الخدمة"
            icon={<Sparkles aria-hidden />}
            loading={loading}
            empty="لا توجد خدمات متاحة للحجز في هذه العيادة."
            items={services}
            onSelect={(service) => {
              setSel((prev) => ({ ...prev, service, provider: null, date: '', slot: '' }));
              if (sel.branch) void loadProviders(sel.branch.id, service.id);
              go(2);
            }}
          />
        ) : null}

        {step === 2 ? (
          <ChoiceList
            title="اختر الطبيب"
            icon={<Stethoscope aria-hidden />}
            loading={loading}
            empty="لا يوجد طبيب متاح لهذه الخدمة في هذه العيادة."
            items={providers}
            onSelect={(provider) => {
              setSel((prev) => ({ ...prev, provider, date: '', slot: '' }));
              go(3);
            }}
          />
        ) : null}

        {step === 3 ? (
          <section aria-label="اختر اليوم">
            <h2 className="mb-3 text-lg font-semibold">اختر اليوم</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {nextDays.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => {
                    setSel((prev) => ({ ...prev, date: d.iso, slot: '' }));
                    go(4);
                  }}
                  className="rounded-lg border border-border p-3 text-center transition-colors hover:border-primary hover:bg-muted"
                >
                  <span className="block text-xs text-muted-foreground">{d.weekday}</span>
                  <span className="block text-lg font-semibold tabular-nums">{d.day}</span>
                  <span className="block text-xs text-muted-foreground">{d.month}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              الأيام المغلقة لا تعرض أوقاتًا في الخطوة التالية.
            </p>
          </section>
        ) : null}

        {step === 4 ? (
          <section aria-label="اختر الوقت">
            <h2 className="mb-3 text-lg font-semibold">اختر الوقت</h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">جارٍ جلب الأوقات المتاحة…</p>
            ) : slots.length === 0 ? (
              <Alert variant="warning" title="لا أوقات متاحة في هذا اليوم">
                قد تكون العيادة مغلقة في هذا اليوم أو مواعيد الطبيب كاملة. اختر يومًا آخر.
              </Alert>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSel((prev) => ({ ...prev, slot: s }));
                      go(5);
                    }}
                    className={`rounded-lg border px-2 py-2.5 text-sm tabular-nums transition-colors ${
                      sel.slot === s
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary hover:bg-muted'
                    }`}
                  >
                    {formatTime(s)}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {step >= 5 ? (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <section className={step === 5 ? '' : 'hidden'} aria-label="بياناتك">
              <h2 className="mb-3 text-lg font-semibold">بياناتك</h2>
              <div className="space-y-4">
                <Field label="الاسم الكامل" required htmlFor="full_name">
                  <Input id="full_name" name="full_name" required autoComplete="name" />
                </Field>
                <Field label="رقم الجوال" required htmlFor="phone" hint="نتواصل معك عليه عند الحاجة">
                  <Input
                    id="phone"
                    name="phone"
                    required
                    dir="ltr"
                    className="text-start"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </Field>
                <Field label="البريد الإلكتروني" htmlFor="email" hint="اختياري">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    dir="ltr"
                    className="text-start"
                    autoComplete="email"
                  />
                </Field>
                <Field label="ملاحظات" htmlFor="notes" hint="اختياري">
                  <Textarea id="notes" name="notes" rows={2} />
                </Field>

                {/*
                  حقل الفخّ: مخفي بصريًا وعن قارئات الشاشة وخارج ترتيب التنقّل.
                  ⚠️ لا نستخدم display:none — بعض الروبوتات تتجاهل الحقول المخفية
                     بهذه الطريقة تحديدًا.
                */}
                <div aria-hidden className="pointer-events-none absolute -left-[9999px] opacity-0">
                  <label htmlFor={HONEYPOT_FIELD}>لا تملأ هذا الحقل</label>
                  <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
                </div>
              </div>

              <Button type="button" className="mt-5" onClick={() => go(6)}>
                متابعة إلى التأكيد
              </Button>
            </section>

            <section className={step === 6 ? '' : 'hidden'} aria-label="تأكيد الحجز">
              <h2 className="mb-3 text-lg font-semibold">تأكيد الحجز</h2>
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  <SummaryRow label="العيادة" value={sel.branch?.nameAr ?? '—'} />
                  <SummaryRow label="الخدمة" value={sel.service?.nameAr ?? '—'} />
                  <SummaryRow label="الطبيب" value={sel.provider?.nameAr ?? '—'} />
                  <SummaryRow label="التاريخ" value={sel.slot ? formatDate(sel.slot) : '—'} />
                  <SummaryRow label="الوقت" value={sel.slot ? formatTime(sel.slot) : '—'} />
                </CardContent>
              </Card>

              <p className="mt-3 text-xs text-muted-foreground">
                بتأكيدك يُحجز الموعد باسمك. لا يوجد أي دفع أو رسوم في هذه الخطوة.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="submit" size="lg" loading={submitting} disabled={!sel.slot}>
                  <Check aria-hidden />
                  تأكيد الحجز
                </Button>
                <Button type="button" variant="outline" onClick={() => go(5)} disabled={submitting}>
                  تعديل البيانات
                </Button>
              </div>
            </section>
          </form>
        ) : null}
      </div>

      {step > 0 ? (
        <Button variant="ghost" className="mt-8" onClick={() => go(step - 1)} disabled={submitting}>
          <ArrowRight aria-hidden />
          رجوع
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------- مكوّنات -------------------------------- */

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mt-6 flex flex-wrap gap-1.5" aria-label="خطوات الحجز">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? 'step' : undefined}
          className={`rounded-full px-3 py-1 text-xs ${
            index < current
              ? 'bg-primary/10 text-primary'
              : index === current
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

function ChoiceList({
  title,
  icon,
  items,
  onSelect,
  empty,
  loading = false,
}: {
  title: string;
  icon: React.ReactNode;
  items: readonly { id: string; nameAr: string; subtitle?: string | null }[];
  onSelect: (item: { id: string; nameAr: string; subtitle?: string | null }) => void;
  empty: string;
  loading?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <Alert variant="warning" title={empty}>
          جرّب اختيارًا آخر أو تواصل مع الفرع مباشرة.
        </Alert>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className="flex items-start gap-3 rounded-lg border border-border p-4 text-start transition-colors hover:border-primary hover:bg-muted"
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
                {icon}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{item.nameAr}</span>
                {item.subtitle ? (
                  <span className="block text-xs text-muted-foreground">{item.subtitle}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/* -------------------------------- تنسيق --------------------------------- */

/**
 * ⚠️ كل التنسيق بتوقيت الرياض صراحةً: الاعتماد على توقيت جهاز الزائر يجعله
 *    يرى وقتًا مختلفًا عن الموعد الفعلي في العيادة إن كان مسافرًا.
 */
const RIYADH = 'Asia/Riyadh';

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: RIYADH,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: RIYADH,
    dateStyle: 'full',
  }).format(new Date(iso));
}

function buildNextDays(count: number) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: RIYADH,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    days.push({
      iso: parts,
      weekday: new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: RIYADH, weekday: 'short' }).format(d),
      day: new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: RIYADH, day: 'numeric' }).format(d),
      month: new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: RIYADH, month: 'short' }).format(d),
    });
  }
  return days;
}

export { Clock };

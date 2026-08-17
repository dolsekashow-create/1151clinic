import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarCheck, CalendarPlus, Home, MapPin, Phone } from 'lucide-react';
import { Button, Card, CardContent, Separator } from '@erp/ui';
import { getPublicBooking } from '@/modules/public-site/booking';

export const metadata: Metadata = {
  title: 'تم تأكيد الحجز',
  // ⚠️ صفحة نتيجة شخصية — لا تُفهرس بحال
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ ref: string }>;
}

/**
 * صفحة تأكيد الحجز.
 *
 * ⚠️ الرقم المرجعي متسلسل ⇒ قابل للتخمين. لذلك لا تعرض هذه الصفحة **أي بيانات
 *    شخصية**: لا اسم عميل ولا هاتفه ولا بريده ولا ملاحظاته. دالة قاعدة البيانات
 *    نفسها لا تُرجعها أصلًا، فالقيد مفروض في المحرّك لا في هذا الملف.
 *    ما يظهر (فرع، خدمة، طبيب، وقت) معلومات إشغال يمكن استنتاجها من شاشة
 *    الأوقات المتاحة، فتخمين الرقم لا يكشف شيئًا جديدًا عن أي شخص.
 */
export default async function ConfirmationPage({ params }: PageProps) {
  const { ref } = await params;
  const booking = await getPublicBooking(decodeURIComponent(ref));

  if (!booking) notFound();

  const dateLabel = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'full',
  }).format(new Date(booking.scheduledAt));

  const timeLabel = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(booking.scheduledAt));

  const rows: ReadonlyArray<[string, string]> = [
    ['الخدمة', booking.serviceName ?? '—'],
    ['الطبيب', booking.providerName ?? '—'],
    ['الفرع', booking.branchName],
    ['التاريخ', dateLabel],
    ['الوقت', timeLabel],
    ['المدة', `${booking.durationMinutes} دقيقة`],
  ];

  return (
    <div className="mx-auto max-w-xl px-4 py-14 lg:px-6">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarCheck className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold">تم تأكيد حجزك</h1>
        <p className="mt-2 text-muted-foreground">احتفظ برقم الحجز للمراجعة عند الحضور.</p>

        <p className="mt-6 text-xs text-muted-foreground">رقم الحجز</p>
        <p className="font-mono text-3xl font-bold tracking-wider" dir="ltr">
          {booking.referenceNo}
        </p>
      </div>

      <Card className="mt-8">
        <CardContent className="divide-y divide-border p-0">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 p-3.5 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {booking.branchCity || booking.branchPhone ? (
        <>
          <Separator className="my-6" />
          <div className="space-y-2 text-sm text-muted-foreground">
            {booking.branchCity ? (
              <p className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {booking.branchCity}
              </p>
            ) : null}
            {booking.branchPhone ? (
              <p className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden />
                <span dir="ltr">{booking.branchPhone}</span>
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">
            <Home aria-hidden />
            العودة للرئيسية
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/book">
            <CalendarPlus aria-hidden />
            حجز موعد آخر
          </Link>
        </Button>
      </div>
    </div>
  );
}

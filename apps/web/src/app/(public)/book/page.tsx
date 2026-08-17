import type { Metadata } from 'next';
import { EmptyState } from '@erp/ui';
import { CalendarPlus } from 'lucide-react';
import { listPublicBranches } from '@/modules/public-site/repository';
import { BookingWizard } from '@/modules/public-site/ui/booking-wizard';

/**
 * ⚠️ SEO كامل مؤجَّل لمرحلة لاحقة. هنا العناصر الأساسية فقط: عنوان ووصف
 *    و`canonical`. الفهرسة تبقى معطّلة كبقية الموقع العام حتى تُعتمد مرحلة SEO.
 */
export const metadata: Metadata = {
  title: 'احجز موعدًا',
  description: 'احجز موعدك في الفرع الأقرب إليك خلال دقائق وبلا تسجيل دخول.',
  alternates: { canonical: '/book' },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BookPage() {
  // ⚠️ بدور anon ⇒ الفروع المنشورة فقط، والمنشأة نفسها يجب أن تكون منشورة
  const branches = await listPublicBranches();

  if (branches.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 lg:px-6">
        <EmptyState
          icon={<CalendarPlus aria-hidden />}
          title="الحجز غير متاح حاليًا"
          description="لا توجد فروع منشورة للحجز في الوقت الحالي. تواصل معنا وسنساعدك."
        />
      </div>
    );
  }

  return <BookingWizard branches={branches} />;
}

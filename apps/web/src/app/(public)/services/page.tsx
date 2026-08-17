import type { Metadata } from 'next';
import { Clock, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@erp/ui';
import { listPublicServices } from '@/modules/public-site/repository';

export const metadata: Metadata = { title: 'الخدمات', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** ⚠️ يقرأ بدور anon — الخدمات المنشورة فقط. بلا أسعار (P-14 معلّقة). */
export default async function PublicServicesPage() {
  const services = await listPublicServices();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 lg:px-6">
      <h1 className="text-2xl font-bold">خدماتنا</h1>
      <p className="mt-2 text-muted-foreground">تعرّف على الخدمات المتوفرة في مراكزنا.</p>

      {services.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="لا توجد خدمات منشورة حاليًا"
            description="ستظهر الخدمات هنا عند نشرها من لوحة الإدارة."
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Card key={service.id}>
              <CardHeader>
                <CardTitle>{service.nameAr}</CardTitle>
                {service.durationMinutes ? (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-4" aria-hidden />
                    {service.durationMinutes} دقيقة
                  </p>
                ) : null}
              </CardHeader>
              {service.description ? (
                <CardContent className="text-sm text-muted-foreground">{service.description}</CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

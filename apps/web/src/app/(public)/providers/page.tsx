import type { Metadata } from 'next';
import { Stethoscope } from 'lucide-react';
import { Card, CardHeader, CardTitle, EmptyState } from '@erp/ui';
import { listPublicProviders } from '@/modules/public-site/repository';

export const metadata: Metadata = { title: 'الأطباء', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * ⚠️ يقرأ بدور anon — المقدّمون المنشورون فقط.
 *    الهاتف والبريد **محجوبان على مستوى الأعمدة** فيستحيل كشفهما من هنا.
 */
export default async function PublicProvidersPage() {
  const providers = await listPublicProviders();

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-clinic-ink">أطباؤنا</h1>
      <p className="mt-2 text-muted-foreground">نخبة من أطباء التجميل والأخصائيين المعتمدين.</p>

      {providers.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Stethoscope aria-hidden />}
            title="لا يوجد أطباء منشورون حاليًا"
            description="يظهر الأطباء هنا فور نشرهم من لوحة الإدارة."
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader>
                <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
                  <Stethoscope aria-hidden />
                </span>
                <CardTitle>{provider.nameAr}</CardTitle>
                {provider.specialty ? (
                  <p className="text-sm text-muted-foreground">{provider.specialty}</p>
                ) : null}
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

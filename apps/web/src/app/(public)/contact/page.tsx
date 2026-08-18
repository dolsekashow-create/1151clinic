import type { Metadata } from 'next';
import { MapPin, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@erp/ui';
import { listPublicBranches } from '@/modules/public-site/repository';

export const metadata: Metadata = { title: 'تواصل معنا', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** بيانات التواصل تُشتق من الفروع المنشورة — لا جدول محتوى منفصل (قرار 14). */
export default async function PublicContactPage() {
  const branches = await listPublicBranches();

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-clinic-ink">تواصل معنا</h1>
      <p className="mt-2 text-muted-foreground">اتصل بالعيادة الأقرب إليك، أو احجز موعدك مباشرة عبر الموقع.</p>

      {branches.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="لا توجد بيانات تواصل منشورة حاليًا" />
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {branches.map((branch) => (
            <Card key={branch.id}>
              <CardHeader>
                <CardTitle>{branch.nameAr}</CardTitle>
                {branch.city ? <p className="text-sm text-muted-foreground">{branch.city}</p> : null}
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {branch.address ? (
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {branch.address}
                  </p>
                ) : null}
                {branch.phone ? (
                  <p className="flex items-center gap-2">
                    <Phone className="size-4 shrink-0" aria-hidden />
                    <span dir="ltr">{branch.phone}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

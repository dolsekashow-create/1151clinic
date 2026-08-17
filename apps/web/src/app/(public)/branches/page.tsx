import type { Metadata } from 'next';
import { MapPin, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@erp/ui';
import { listPublicBranches } from '@/modules/public-site/repository';

export const metadata: Metadata = { title: 'الفروع', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** ⚠️ يقرأ بدور anon عبر RLS — الفروع المنشورة فقط. لا مفتاح سري. */
export default async function PublicBranchesPage() {
  const branches = await listPublicBranches();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 lg:px-6">
      <h1 className="text-2xl font-bold">فروعنا</h1>
      <p className="mt-2 text-muted-foreground">اختر الفرع الأقرب إليك.</p>

      {branches.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<MapPin aria-hidden />}
            title="لا توجد فروع منشورة حاليًا"
            description="ستظهر الفروع هنا عند نشرها من لوحة الإدارة."
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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

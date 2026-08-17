import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Construction } from 'lucide-react';
import { pendingRulesByModule } from '@erp/core';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@erp/ui';
import { findNavItem, findSectionOf } from '@/config/navigation';
import { requireAuth } from '@/modules/auth/session';

/**
 * صفحة الوحدات المُخطَّطة.
 *
 * قرار متعمّد: بدل بناء شاشات وهمية بأزرار لا تعمل وجداول ببيانات مختلقة،
 * تعرض هذه الصفحة بوضوح: ما حالة الوحدة، في أي مرحلة تُبنى، وما القواعد
 * المعلّقة التي تمنع بناءها الآن. واجهة وهمية تُوهم العميل بجاهزية غير موجودة.
 *
 * المسارات غير المعرّفة في خريطة التنقل تُعيد 404 — لا تصبح هذه صفحة مفتوحة.
 */
interface PageProps {
  params: Promise<{ segments: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { segments } = await params;
  const item = findNavItem(`/${segments.join('/')}`);
  return { title: item?.label ?? 'غير موجود' };
}

export default async function PlannedModulePage({ params }: PageProps) {
  const { segments } = await params;
  const href = `/${segments.join('/')}`;
  const item = findNavItem(href);

  if (!item || item.implemented) notFound();

  const ctx = await requireAuth();
  // ⚠️ إخفاء واجهة فقط — لا بيانات تُعرض هنا أصلًا، والحماية الحقيقية في RLS.
  if (item.permission && !ctx.permissions.includes(item.permission)) notFound();

  const section = findSectionOf(href);
  const pendingRules = pendingRulesByModule(item.module);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.label}
        description={item.description}
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          ...(section ? [{ label: section.label }] : []),
          { label: item.label },
        ]}
        actions={<Badge variant="warning">مُخطَّطة — المرحلة {item.phase}</Badge>}
      />

      <Alert variant="info" title="هذه الوحدة قيد الإعداد">
        بنية قاعدة البيانات وسياسات الحماية لهذه الوحدة **منفّذة ومختبَرة** بالفعل.
        الشاشة التشغيلية تُبنى في المرحلة {item.phase}.
      </Alert>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>ما الذي يمنع البناء الآن؟</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا توجد قواعد عمل معلّقة لهذه الوحدة — البناء مُجدوَل ضمن المرحلة {item.phase} فقط.
              </p>
            ) : (
              <ul className="space-y-3">
                {pendingRules.map((rule) => (
                  <li key={rule.id} className="border-s-2 border-warning/50 ps-3">
                    <p className="text-sm font-medium">
                      <span className="me-2 font-mono text-xs text-muted-foreground">{rule.id}</span>
                      {rule.description}
                    </p>
                    <p className="pt-0.5 text-xs text-muted-foreground">{rule.blockingQuestion}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Construction className="size-4 text-muted-foreground" aria-hidden />
              الجاهز فعلًا
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>✔ جداول قاعدة البيانات والعلاقات والفهارس</p>
            <p>✔ سياسات RLS لعزل المنشأة والفرع</p>
            <p>✔ الصلاحيات في الكتالوج</p>
            <p>✔ سجل التدقيق جاهز لاستقبال العمليات</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

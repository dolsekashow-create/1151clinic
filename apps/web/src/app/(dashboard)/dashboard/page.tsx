import type { Metadata } from 'next';
import {
  Building2,
  CalendarCheck,
  Contact,
  Package,
  Users,
  Wallet,
} from 'lucide-react';
import { PENDING_RULES } from '@erp/core';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@erp/ui';
import { checkSupabaseHealth } from '@/infrastructure/supabase/health';

export const metadata: Metadata = { title: 'لوحة المعلومات' };

// فحص الاتصال يتم عند كل طلب — لا يُخزَّن في البناء
export const dynamic = 'force-dynamic';

/**
 * مؤشرات تجريبية.
 * ⚠️ قيم ثابتة معروضة لغرض تصميم الواجهة فقط. لا تُقرأ من قاعدة البيانات،
 *    وكل بطاقة تحمل تنبيهًا صريحًا حتى لا تُقرأ كأنها بيانات إنتاج.
 *    الربط الحقيقي يبدأ في المرحلة 3.
 */
const PLACEHOLDER_STATS = [
  { key: 'branches', label: 'الفروع', value: '—', hint: 'يُقرأ من جدول branches', icon: Building2 },
  { key: 'users', label: 'المستخدمون', value: '—', hint: 'يُقرأ من جدول profiles', icon: Users },
  { key: 'customers', label: 'العملاء', value: '—', hint: 'يُقرأ من جدول customers', icon: Contact },
  {
    key: 'appointments',
    label: 'حجوزات اليوم',
    value: '—',
    hint: 'يُقرأ من جدول appointments',
    icon: CalendarCheck,
  },
  { key: 'inventory', label: 'أصناف تحت الحد', value: '—', hint: 'يُحتسب من stock_levels', icon: Package },
  {
    key: 'finance',
    label: 'صافي حركة اليوم',
    value: '—',
    hint: 'يُحتسب من treasury_movements',
    icon: Wallet,
  },
] as const;

const STATUS_LABEL = {
  ok: { text: 'متصل', variant: 'success' as const },
  not_configured: { text: 'غير مُهيّأ', variant: 'warning' as const },
  unreachable: { text: 'غير متاح', variant: 'danger' as const },
};

export default async function DashboardPage() {
  const health = await checkSupabaseHealth();
  const status = STATUS_LABEL[health.status];

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة المعلومات"
        description="نظرة عامة على حالة النظام. المؤشرات التشغيلية تُربط بقاعدة البيانات في المرحلة 3."
        breadcrumbs={[{ label: 'الرئيسية' }]}
        actions={
          <Badge variant={status.variant}>
            Supabase: {status.text}
            {health.latencyMs !== null ? ` · ${health.latencyMs}ms` : ''}
          </Badge>
        }
      />

      {health.status !== 'ok' ? (
        <Alert variant="warning" title="اتصال قاعدة البيانات غير مكتمل">
          {health.message}
          {health.missingEnv.length > 0 ? (
            <span className="block pt-1 font-mono text-xs">
              المتغيرات الناقصة: {health.missingEnv.join(', ')}
            </span>
          ) : null}
        </Alert>
      ) : null}

      <Alert variant="info" title="المرحلة 1 — الأساس التقني">
        المصادقة والصلاحيات وعزل الفروع تُنفَّذ في المرحلة 2. المؤشرات أدناه غير مرتبطة ببيانات فعلية.
      </Alert>

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          المؤشرات
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PLACEHOLDER_STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <StatCard
                key={stat.key}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                icon={<Icon aria-hidden />}
                placeholder
              />
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>قواعد عمل بانتظار الاعتماد</CardTitle>
            <CardDescription>
              هذه القواعد لم تُحدَّد من الأقسام بعد، ولم يُبنَ لها منطق. كل واحدة منها تُرجع
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">BUSINESS_RULE_PENDING</code>
              إذا استُدعيت.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <TableContainer className="rounded-none border-0 border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">المعرّف</TableHead>
                    <TableHead className="w-32">الوحدة</TableHead>
                    <TableHead>القاعدة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PENDING_RULES.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{rule.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{rule.module}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="block">{rule.description}</span>
                        <span className="block pt-0.5 text-xs text-muted-foreground">
                          {rule.blockingQuestion}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>آخر النشاطات</CardTitle>
            <CardDescription>يُقرأ من سجل التدقيق</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="لا توجد نشاطات"
              description="سجل التدقيق يبدأ بالتسجيل بعد تفعيل المصادقة في المرحلة 2."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

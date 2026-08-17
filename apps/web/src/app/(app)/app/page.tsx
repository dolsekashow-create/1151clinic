import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, CalendarCheck, Contact, Package, Users, Wallet } from 'lucide-react';
import { PENDING_RULES, hasPermission } from '@erp/core';
import type { AuthContext } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
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
import { createClient } from '@/infrastructure/supabase/server';
import { requireAuth } from '@/modules/auth/session';

export const metadata: Metadata = { title: 'لوحة المعلومات' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL = {
  ok: { text: 'متصل', variant: 'success' as const },
  not_configured: { text: 'غير مُهيّأ', variant: 'warning' as const },
  invalid_key: { text: 'مفتاح مرفوض', variant: 'danger' as const },
  unreachable: { text: 'غير متاح', variant: 'danger' as const },
};

/**
 * مؤشرات لوحة المعلومات.
 *
 * ⚠️ كل عدد يُقرأ من قاعدة البيانات بجلسة المستخدم ⇒ الأرقام محكومة بـ RLS:
 *    موظف فرع يرى أعداد فرعه فقط. لا توجد أرقام وهمية على هذه الصفحة.
 *    المؤشرات التي تعتمد على قواعد عمل معلّقة (مثل صافي الحركة اليومية) تُعرض
 *    بوضوح كـ«بانتظار قاعدة عمل» بدل رقم مُخترَع.
 */
async function loadCounts(ctx: AuthContext) {
  const supabase = await createClient();

  const count = async (table: 'branches' | 'profiles' | 'customers' | 'appointments') => {
    const { count: value, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true });
    return error ? null : (value ?? 0);
  };

  const [branches, users, customers, appointments] = await Promise.all([
    hasPermission(ctx, 'organizations.branches.view') ? count('branches') : Promise.resolve(null),
    hasPermission(ctx, 'identity.users.view') ? count('profiles') : Promise.resolve(null),
    hasPermission(ctx, 'customers.view') ? count('customers') : Promise.resolve(null),
    hasPermission(ctx, 'appointments.view') ? count('appointments') : Promise.resolve(null),
  ]);

  return { branches, users, customers, appointments };
}

function formatCount(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('ar-EG').format(value);
}

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const [health, counts] = await Promise.all([checkSupabaseHealth(), loadCounts(ctx)]);
  const status = STATUS_LABEL[health.status];

  const stats = [
    {
      key: 'branches',
      label: 'الفروع',
      value: formatCount(counts.branches),
      hint: counts.branches === null ? 'لا تملك صلاحية العرض' : 'ضمن نطاق وصولك',
      icon: Building2,
      pending: false,
    },
    {
      key: 'users',
      label: 'المستخدمون',
      value: formatCount(counts.users),
      hint: counts.users === null ? 'لا تملك صلاحية العرض' : 'ضمن نطاق وصولك',
      icon: Users,
      pending: false,
    },
    {
      key: 'customers',
      label: 'العملاء',
      value: formatCount(counts.customers),
      hint: counts.customers === null ? 'لا تملك صلاحية العرض' : 'ضمن نطاق وصولك',
      icon: Contact,
      pending: false,
    },
    {
      key: 'appointments',
      label: 'الحجوزات',
      value: formatCount(counts.appointments),
      hint: counts.appointments === null ? 'لا تملك صلاحية العرض' : 'ضمن نطاق وصولك',
      icon: CalendarCheck,
      pending: false,
    },
    {
      key: 'inventory',
      label: 'أصناف تحت حد الطلب',
      value: '—',
      hint: 'يتطلب اعتماد قاعدة الرصيد وحد الطلب (P-07)',
      icon: Package,
      pending: true,
    },
    {
      key: 'finance',
      label: 'صافي حركة اليوم',
      value: '—',
      hint: 'يتطلب اعتماد قواعد الترحيل المالي (P-02، P-03)',
      icon: Wallet,
      pending: true,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة المعلومات"
        description="نظرة عامة على البيانات ضمن نطاق صلاحياتك"
        breadcrumbs={[{ label: 'الرئيسية' }]}
        actions={
          <Badge variant={status.variant}>
            Supabase: {status.text}
            {health.latencyMs !== null ? ` · ${health.latencyMs}ms` : ''}
          </Badge>
        }
      />

      {health.status !== 'ok' ? (
        <Alert variant={health.status === 'invalid_key' ? 'danger' : 'warning'} title="حالة الاتصال">
          {health.message}
          {health.missingEnv.length > 0 ? (
            <span className="block pt-1 font-mono text-xs">
              المتغيرات الناقصة: {health.missingEnv.join(', ')}
            </span>
          ) : null}
          {health.projectRef ? (
            <span className="block pt-1 font-mono text-xs" dir="ltr">
              project: {health.projectRef}
            </span>
          ) : null}
        </Alert>
      ) : null}

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          المؤشرات
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <StatCard
                key={stat.key}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                icon={<Icon aria-hidden />}
                placeholder={stat.pending}
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
              لم تُحدَّد من الأقسام بعد، ولم يُبنَ لها منطق. استدعاؤها يُرجع
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">BUSINESS_RULE_PENDING</code>
              بدل تنفيذ سلوك مُخترَع.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <TableContainer className="rounded-none border-0 border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">المعرّف</TableHead>
                    <TableHead className="w-32">الوحدة</TableHead>
                    <TableHead>القاعدة والسؤال المطلوب إجابته</TableHead>
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
            <CardDescription>من سجل التدقيق</CardDescription>
          </CardHeader>
          <CardContent>
            {hasPermission(ctx, 'audit.view') ? (
              <RecentActivity />
            ) : (
              <EmptyState
                title="لا تملك صلاحية عرض سجل التدقيق"
                description="اطلب صلاحية audit.view من مدير النظام."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function RecentActivity() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="لا توجد نشاطات بعد"
        description="تُسجَّل العمليات تلقائيًا عند تنفيذها."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/app/customers">ابدأ من العملاء</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {data.map((entry) => (
        <li key={entry.id} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{entry.action}</p>
            <p className="text-xs text-muted-foreground">{entry.entity_type}</p>
          </div>
          <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={entry.created_at}>
            {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(entry.created_at),
            )}
          </time>
        </li>
      ))}
    </ul>
  );
}

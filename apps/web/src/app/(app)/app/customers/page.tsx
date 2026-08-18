import type { Metadata } from 'next';
import { Suspense } from 'react';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { createClient } from '@/infrastructure/supabase/server';
import { listCustomersAction } from '@/modules/customers/actions';
import { CustomersTable } from '@/modules/customers/ui/customers-table';

export const metadata: Metadata = { title: 'العملاء' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function CustomersPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="العملاء"
        description="سجل العملاء ضمن الفروع المصرّح لك بها"
        breadcrumbs={[{ label: 'الرئيسية', href: '/app' }, { label: 'العملاء' }]}
      />
      <Suspense fallback={<LoadingState />}>
        <CustomersContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CustomersContent({ searchParams }: PageProps) {
  const params = await searchParams;
  const ctx = await requireAuth();

  const result = await listCustomersAction({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    search: params.search,
    branchId: params.branchId,
    status: params.status,
  });

  const branches = await loadBranches();

  return (
    <CustomersTable
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      branches={branches}
      canCreate={hasPermission(ctx, 'customers.create')}
      canDelete={hasPermission(ctx, 'customers.delete')}
      defaultBranchId={ctx.branchIds[0] ?? null}
    />
  );
}

/**
 * قائمة الفروع للفلترة والإسناد.
 * ⚠️ تُقرأ عبر RLS ⇒ تحتوي فقط الفروع التي يصلها المستخدم فعلًا.
 *    لا حاجة لفلترة إضافية في الكود، والاعتماد عليها وحدها لن يكون آمنًا أصلًا.
 */
async function loadBranches(): Promise<Array<{ id: string; nameAr: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branches')
    .select('id, name_ar')
    .is('deleted_at', null)
    .order('name_ar');

  return (data ?? []).map((row) => ({ id: row.id, nameAr: row.name_ar }));
}

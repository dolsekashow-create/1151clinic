import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listDepartmentsAction } from '@/modules/organizations/actions';
import { listBranchOptions } from '@/modules/organizations/repository';
import { DepartmentsView } from '@/modules/organizations/ui/departments-view';

export const metadata: Metadata = { title: 'الأقسام والإدارات' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function DepartmentsPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الأقسام والإدارات"
        description="الأقسام المركزية على مستوى المنشأة والأقسام التابعة للفروع"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'التنظيم' },
          { label: 'الأقسام والإدارات' },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: PageProps) {
  const params = await searchParams;
  const ctx = await requireAuth();
  if (!hasPermission(ctx, 'organizations.departments.view')) notFound();

  const [result, branches] = await Promise.all([
    listDepartmentsAction({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      search: params.search,
      status: params.status,
    }),
    listBranchOptions(),
  ]);

  return (
    <DepartmentsView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      branches={branches}
      canManage={hasPermission(ctx, 'organizations.departments.manage')}
      canDelete={hasPermission(ctx, 'organizations.departments.delete')}
      hasOrgScope={ctx.hasOrganizationScope}
    />
  );
}

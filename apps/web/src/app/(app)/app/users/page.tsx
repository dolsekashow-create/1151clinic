import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listUsersAction, listRolesAction } from '@/modules/identity/actions';
import { listBranchOptions, listProvidersWithoutAccount } from '@/modules/identity/repository';
import { UsersView } from '@/modules/identity/ui/users-view';

export const metadata: Metadata = { title: 'المستخدمون' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function UsersPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="المستخدمون"
        description="حسابات الدخول وأدوارها ونطاقاتها وفروعها"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'المستخدمون والصلاحيات' },
          { label: 'المستخدمون' },
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
  if (!hasPermission(ctx, 'identity.users.view')) notFound();

  const canCreate = hasPermission(ctx, 'identity.users.create');

  const [result, roles, branches, providers] = await Promise.all([
    listUsersAction({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      search: params.search,
      status: params.status,
    }),
    // الأدوار مطلوبة للنموذج فقط — من لا يملك صلاحية عرضها لا يُنشئ مستخدمين
    hasPermission(ctx, 'identity.roles.view') ? listRolesAction({}) : null,
    listBranchOptions(),
    canCreate ? listProvidersWithoutAccount() : [],
  ]);

  return (
    <UsersView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      roles={roles?.success ? roles.data : []}
      branches={branches}
      providers={providers}
      canCreate={canCreate && Boolean(roles?.success)}
      hasOrgScope={ctx.hasOrganizationScope}
    />
  );
}

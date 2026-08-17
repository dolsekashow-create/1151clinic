import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { ErrorState, LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import {
  getUserAction,
  getUserPermissionsAction,
  listRolesAction,
} from '@/modules/identity/actions';
import { listBranchOptions } from '@/modules/identity/repository';
import { UserDetailView } from '@/modules/identity/ui/user-detail-view';

export const metadata: Metadata = { title: 'تفاصيل المستخدم' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="تفاصيل المستخدم"
        description="البيانات والدور والنطاق والفروع والصلاحيات الفعلية"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'المستخدمون', href: '/app/users' },
          { label: 'التفاصيل' },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (!hasPermission(ctx, 'identity.users.view')) notFound();

  const [userResult, permissionsResult, rolesResult, branches] = await Promise.all([
    getUserAction({ id }),
    getUserPermissionsAction({ id }),
    hasPermission(ctx, 'identity.roles.view') ? listRolesAction({}) : null,
    listBranchOptions(),
  ]);

  // RLS تُخفي المستخدمين خارج النطاق ⇒ 404 لا 403: لا نكشف وجود سجل لا يُرى.
  if (!userResult.success) {
    if (userResult.error.code === 'NOT_FOUND') notFound();
    return <ErrorState description={userResult.error.message} />;
  }

  return (
    <UserDetailView
      user={userResult.data}
      roles={rolesResult?.success ? rolesResult.data : []}
      branches={branches}
      permissions={permissionsResult.success ? permissionsResult.data : []}
      canUpdate={hasPermission(ctx, 'identity.users.update')}
      canManageRoles={
        hasPermission(ctx, 'identity.roles.manage') && hasPermission(ctx, 'identity.branches.assign')
      }
      hasOrgScope={ctx.hasOrganizationScope}
      isSelf={ctx.userId === id}
    />
  );
}

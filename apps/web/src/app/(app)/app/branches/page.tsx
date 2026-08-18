import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listBranchesAction } from '@/modules/organizations/actions';
import { BranchesView } from '@/modules/organizations/ui/branches-view';

export const metadata: Metadata = { title: 'الفروع' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function BranchesPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الفروع"
        description="إدارة فروع المنشأة والتحكم في ظهورها على الموقع العام"
        breadcrumbs={[{ label: 'الرئيسية', href: '/app' }, { label: 'التنظيم' }, { label: 'الفروع' }]}
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

  // ⚠️ إخفاء واجهة فقط — RLS والخادم هما الحاجز الفعلي
  if (!hasPermission(ctx, 'organizations.branches.view')) notFound();

  const result = await listBranchesAction({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    search: params.search,
    status: params.status,
    isPublic: params.isPublic,
  });

  return (
    <BranchesView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      canCreate={hasPermission(ctx, 'organizations.branches.create')}
      canUpdate={hasPermission(ctx, 'organizations.branches.update')}
      canDelete={hasPermission(ctx, 'organizations.branches.delete')}
      canPublish={hasPermission(ctx, 'organizations.branches.publish')}
    />
  );
}

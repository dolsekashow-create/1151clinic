import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listProvidersAction } from '@/modules/catalog/actions';
import { ProvidersView } from '@/modules/catalog/ui/catalog-views';

export const metadata: Metadata = { title: 'مقدّمو الخدمة' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ProvidersPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="مقدّمو الخدمة"
        description="إدارة الأطباء ومقدّمي الخدمة والتحكم في ظهورها على الموقع العام"
        breadcrumbs={[{ label: 'الرئيسية', href: '/app' }, { label: 'العمليات' }, { label: 'مقدّمو الخدمة' }]}
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
  if (!hasPermission(ctx, 'services.providers.view')) notFound();

  const result = await listProvidersAction({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    search: params.search,
    status: params.status,
    isPublic: params.isPublic,
  });

  return (
    <ProvidersView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      canCreate={hasPermission(ctx, 'services.providers.manage')}
      canManage={hasPermission(ctx, 'services.providers.manage')}
      canPublish={hasPermission(ctx, 'services.providers.publish')}
    />
  );
}

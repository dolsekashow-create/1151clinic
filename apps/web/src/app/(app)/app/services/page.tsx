import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listServicesAction } from '@/modules/catalog/actions';
import { ServicesView } from '@/modules/catalog/ui/catalog-views';

export const metadata: Metadata = { title: 'الخدمات' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ServicesPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الخدمات"
        description="إدارة الخدمات والتحكم في ظهورها على الموقع العام"
        breadcrumbs={[{ label: 'الرئيسية', href: '/app' }, { label: 'العمليات' }, { label: 'الخدمات' }]}
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
  if (!hasPermission(ctx, 'services.view')) notFound();

  const result = await listServicesAction({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 25,
    search: params.search,
    status: params.status,
    isPublic: params.isPublic,
  });

  return (
    <ServicesView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      canCreate={hasPermission(ctx, 'services.create')}
      canUpdate={hasPermission(ctx, 'services.update')}
      canDelete={hasPermission(ctx, 'services.delete')}
      canPublish={hasPermission(ctx, 'services.publish')}
    />
  );
}

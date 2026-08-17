import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { ErrorState, LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { getOrganizationAction } from '@/modules/organizations/actions';
import { SettingsView } from '@/modules/organizations/ui/settings-view';

export const metadata: Metadata = { title: 'إعدادات المنشأة' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="إعدادات المنشأة"
        description="بيانات المنشأة وبيانات التواصل وحالة الظهور على الموقع العام"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'النظام' },
          { label: 'إعدادات المنشأة' },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  const ctx = await requireAuth();
  if (!hasPermission(ctx, 'organizations.organization.view')) notFound();

  const result = await getOrganizationAction({});
  if (!result.success) return <ErrorState description={result.error.message} />;

  return (
    <SettingsView
      organization={result.data}
      canUpdate={hasPermission(ctx, 'organizations.organization.update')}
      canPublish={hasPermission(ctx, 'organizations.organization.publish')}
    />
  );
}

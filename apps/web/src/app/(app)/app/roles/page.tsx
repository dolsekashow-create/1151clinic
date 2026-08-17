import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PERMISSIONS, hasPermission } from '@erp/core';
import { ErrorState, LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listRolesAction } from '@/modules/identity/actions';
import { RolesView } from '@/modules/identity/ui/roles-view';

export const metadata: Metadata = { title: 'الأدوار والصلاحيات' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الأدوار والصلاحيات"
        description="الأدوار النظامية وأدوار المنشأة الخاصة"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'المستخدمون والصلاحيات' },
          { label: 'الأدوار' },
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
  if (!hasPermission(ctx, 'identity.roles.view')) notFound();

  const result = await listRolesAction({});
  if (!result.success) return <ErrorState description={result.error.message} />;

  return (
    <RolesView
      roles={result.data}
      // كتالوج الصلاحيات من الكود لا من قاعدة البيانات: هو المصدر الوحيد للحقيقة
      permissions={PERMISSIONS.map((p) => ({
        key: p.key,
        nameAr: p.nameAr,
        module: p.module,
        sensitive: p.sensitive ?? false,
      }))}
      // سقف ما يمكن منحه = ما يملكه المُدير. الحكم النهائي في المحفّز.
      grantablePermissions={ctx.permissions}
      canManage={hasPermission(ctx, 'identity.roles.manage')}
    />
  );
}

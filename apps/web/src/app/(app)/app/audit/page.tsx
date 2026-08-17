import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listAuditLogsAction } from '@/modules/audit/actions';
import { listAuditModules } from '@/modules/audit/repository';
import { listBranchOptions } from '@/modules/organizations/repository';
import { AuditView } from '@/modules/audit/ui/audit-view';

export const metadata: Metadata = { title: 'سجل التدقيق' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="سجل التدقيق"
        description="من غيّر ماذا ومتى — سجل غير قابل للتعديل"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'النظام' },
          { label: 'سجل التدقيق' },
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
  if (!hasPermission(ctx, 'audit.view')) notFound();

  const [result, modules, branches] = await Promise.all([
    listAuditLogsAction({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 50,
      module: params.module,
      action: params.action,
      branchId: params.branchId,
      from: params.from,
      to: params.to,
    }),
    listAuditModules(),
    listBranchOptions(),
  ]);

  return (
    <AuditView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      modules={modules}
      branches={branches}
    />
  );
}

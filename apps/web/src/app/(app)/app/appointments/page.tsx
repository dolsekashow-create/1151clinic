import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import type { UUID } from '@erp/types';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { listAppointmentsAction } from '@/modules/appointments/actions';
import {
  listBranchOptions,
  listBusinessHours,
  listStatusOptions,
} from '@/modules/appointments/repository';
import { AppointmentsView } from '@/modules/appointments/ui/appointments-view';
import { createClient } from '@/infrastructure/supabase/server';

export const metadata: Metadata = { title: 'الحجوزات' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AppointmentsPage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الحجوزات"
        description="الحجز الداخلي لموظفي المنشأة — بلا overbooking وداخل ساعات العمل"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'العمليات' },
          { label: 'الحجوزات' },
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
  if (!hasPermission(ctx, 'appointments.view')) notFound();

  const [result, branches, statuses] = await Promise.all([
    listAppointmentsAction({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      search: params.search,
      branchId: params.branchId,
      providerId: params.providerId,
      statusId: params.statusId,
      date: params.date,
    }),
    listBranchOptions(),
    listStatusOptions(),
  ]);

  // مرشِّح مقدّمي الخدمة وساعات العمل يتبعان الفرع المختار
  const selectedBranch = params.branchId ?? branches[0]?.id ?? null;
  const [providers, hours] = await Promise.all([
    selectedBranch ? listAllProviders(selectedBranch) : Promise.resolve([]),
    selectedBranch ? listBusinessHours(selectedBranch) : Promise.resolve([]),
  ]);

  return (
    <AppointmentsView
      result={result.success ? result.data : null}
      error={result.success ? null : result.error}
      branches={branches}
      providers={providers}
      statuses={statuses}
      hours={hours}
      canCreate={hasPermission(ctx, 'appointments.create')}
      canEditHours={hasPermission(ctx, 'organizations.branches.update')}
    />
  );
}

/**
 * مقدّمو الخدمة في فرع — لمرشِّح القائمة فقط، بلا تقييد بخدمة.
 * ⚠️ نموذج الحجز يستخدم قائمة أضيق (المتاحون للخدمة المختارة) عمدًا: المرشِّح
 *    يخدم البحث في القائمة، والنموذج يجب أن يطابق ما يقبله المحرّك بالضبط.
 */
async function listAllProviders(branchId: string) {
  const supabase = await createClient();
  const { data: orgWide } = await supabase
    .from('provider_branches')
    .select('provider_id')
    .eq('branch_id', branchId);
  const orgWideIds = new Set((orgWide ?? []).map((p) => p.provider_id));

  const { data } = await supabase
    .from('service_providers')
    .select('id, full_name_ar, branch_id')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('full_name_ar');

  return (data ?? [])
    .filter((p) => (p.branch_id === null ? orgWideIds.has(p.id) : p.branch_id === branchId))
    .map((p) => ({ id: p.id as UUID, nameAr: p.full_name_ar }));
}

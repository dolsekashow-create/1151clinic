import type { Metadata } from 'next';
import { Suspense } from 'react';
import { hasPermission } from '@erp/core';
import { LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import {
  getMonthlySummaryAction,
  listAttendanceAction,
  listBranchLocationsAction,
} from '@/modules/attendance/actions';
import { getOpenSession } from '@/modules/attendance/repository';
import { listBranchOptions } from '@/modules/appointments/repository';
import { AttendanceView } from '@/modules/attendance/ui/attendance-view';
import { createClient } from '@/infrastructure/supabase/server';

export const metadata: Metadata = { title: 'الحضور والانصراف' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AttendancePage({ searchParams }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="الحضور والانصراف"
        description="تسجيل الحضور بالموقع الجغرافي وسجل الساعات الشهري"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'الموظفون' },
          { label: 'الحضور والانصراف' },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * ⚠️ لا `notFound()` هنا خلافًا لبقية الشاشات: تسجيل الحضور حق كل موظف بلا
 *    صلاحية. من لا يملك `attendance.view` يرى ساعته وسجله الشخصي فقط، والباقي
 *    يُخفى — والإخفاء يتم في **قاعدة البيانات** لا في هذا الملف.
 */
async function Content({ searchParams }: PageProps) {
  const params = await searchParams;
  const ctx = await requireAuth();

  const canViewAll = hasPermission(ctx, 'attendance.view');
  const canEditLocations = hasPermission(ctx, 'organizations.branches.update');

  // شهر الملخّص: أول يوم في الشهر المطلوب أو الحالي
  const month = params.month ? `${params.month}-01` : `${new Date().toISOString().slice(0, 7)}-01`;

  const [openSession, myBranches, sessions, summary, locations, branches] = await Promise.all([
    getOpenSession(ctx),
    listMyBranches(ctx.branchIds),
    listAttendanceAction({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      branchId: params.branchId,
      status: params.status,
      from: params.from,
      to: params.to,
    }),
    canViewAll
      ? getMonthlySummaryAction({ month, branchId: params.branchId })
      : Promise.resolve(null),
    canEditLocations ? listBranchLocationsAction({}) : Promise.resolve(null),
    canViewAll ? listBranchOptions() : Promise.resolve([]),
  ]);

  return (
    <AttendanceView
      openSession={openSession}
      myBranches={myBranches}
      sessions={sessions.success ? sessions.data : null}
      error={sessions.success ? null : sessions.error}
      summary={summary?.success ? summary.data : []}
      branches={branches}
      locations={locations?.success ? locations.data : []}
      canViewAll={canViewAll}
      canManage={hasPermission(ctx, 'attendance.manage')}
      canEditLocations={canEditLocations}
    />
  );
}

/**
 * فروع المستخدم المُسنَدة — لاختيار فرع التسجيل.
 * ⚠️ صاحب نطاق المنشأة قد يكون بلا `user_branches`؛ عندها يختار من كل الفروع.
 */
async function listMyBranches(branchIds: readonly string[]) {
  const supabase = await createClient();
  let query = supabase
    .from('branches')
    .select('id, name_ar')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name_ar');

  if (branchIds.length > 0) query = query.in('id', branchIds as string[]);

  const { data } = await query;
  return (data ?? []).map((b) => ({ id: b.id, nameAr: b.name_ar }));
}

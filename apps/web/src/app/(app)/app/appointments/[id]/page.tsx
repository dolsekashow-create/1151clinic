import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { hasPermission } from '@erp/core';
import { ErrorState, LoadingState, PageHeader } from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';
import { getAppointmentAction } from '@/modules/appointments/actions';
import { listStatusOptions } from '@/modules/appointments/repository';
import { AppointmentDetailView } from '@/modules/appointments/ui/appointment-detail-view';

export const metadata: Metadata = { title: 'تفاصيل الحجز' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AppointmentDetailPage({ params }: PageProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="تفاصيل الحجز"
        description="الموعد والعميل والخدمة ومقدّم الخدمة والحالة"
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'الحجوزات', href: '/app/appointments' },
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
  if (!hasPermission(ctx, 'appointments.view')) notFound();

  const [result, statuses] = await Promise.all([getAppointmentAction({ id }), listStatusOptions()]);

  // RLS تُخفي حجوزات الفروع الأخرى ⇒ 404 لا 403: لا نكشف وجود سجل لا يُرى.
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') notFound();
    return <ErrorState description={result.error.message} />;
  }

  return (
    <AppointmentDetailView
      appointment={result.data}
      statuses={statuses}
      canUpdate={hasPermission(ctx, 'appointments.update')}
      canCancel={hasPermission(ctx, 'appointments.cancel')}
    />
  );
}

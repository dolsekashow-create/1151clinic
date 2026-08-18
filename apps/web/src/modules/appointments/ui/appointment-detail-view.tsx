'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Save, User } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
  toast,
} from '@erp/ui';
import type { AppointmentRow, Option, StatusOption } from '../repository';
import {
  listAvailableSlotsAction,
  listProviderOptionsAction,
  setAppointmentStatusAction,
  updateAppointmentAction,
} from '../actions';
import { AppointmentTime, StatusBadge } from './appointments-view';
import { DeleteButton } from '@/shared/components/delete-button';
import { archiveRecordAction } from '@/modules/shared/archive';

export function AppointmentDetailView({
  appointment,
  statuses,
  canUpdate,
  canCancel,
  canDelete,
}: {
  appointment: AppointmentRow;
  statuses: readonly StatusOption[];
  canUpdate: boolean;
  canCancel: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <SummaryCard appointment={appointment} />
        <RescheduleCard appointment={appointment} canUpdate={canUpdate} />
      </div>
      <div className="space-y-6">
        <StatusCard
          appointment={appointment}
          statuses={statuses}
          canUpdate={canUpdate}
          canCancel={canCancel}
        />
        {canDelete ? (
          <Card>
            <CardHeader>
              <CardTitle>حذف الحجز</CardTitle>
              <CardDescription>
                الحذف ≠ الإلغاء. الإلغاء واقعة تشغيلية تبقى في السجل؛ الحذف يُخفي القيد كليًا
                ولا يُستخدم إلا لخطأ إدخال.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeleteButton
                label={appointment.referenceNo ?? 'هذا الحجز'}
                entityLabel="الحجز"
                onDelete={() => archiveRecordAction({ entity: 'appointment', id: appointment.id })}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({ appointment }: { appointment: AppointmentRow }) {
  const rows: ReadonlyArray<[string, string]> = [
    ['العميل', appointment.customerName],
    ['الهاتف', appointment.customerPhone ?? '—'],
    ['الفرع', appointment.branchName],
    ['الخدمة', appointment.serviceName ?? '—'],
    ['مقدّم الخدمة', appointment.providerName ?? '—'],
    ['المدة', `${appointment.durationMinutes} دقيقة`],
    ['رقم الحجز', appointment.referenceNo ?? '—'],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          <AppointmentTime instant={appointment.scheduledAt} />
          <span className="text-muted-foreground">←</span>
          <AppointmentTime instant={appointment.endsAt} />
        </CardTitle>
        <CardDescription>الأوقات بتوقيت الفرع المحلي.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {appointment.notes ? (
          <>
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">ملاحظات</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{appointment.notes}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * إعادة الجدولة.
 * ⚠️ الفرع غير قابل للتعديل: نقل الحجز بين الفروع يغيّر نطاقه الأمني ويجعل
 *    عميل فرع تابعًا لفرع آخر. الإجراء الصحيح إلغاء وإنشاء حجز جديد.
 * ⚠️ الأوقات من `available_slots` في المحرّك — لا حساب موازٍ في المتصفح.
 */
function RescheduleCard({
  appointment,
  canUpdate,
}: {
  appointment: AppointmentRow;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const [providers, setProviders] = useState<readonly Option[]>([]);
  const [providerId, setProviderId] = useState(appointment.providerId ?? '');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<readonly string[]>([]);
  const [slot, setSlot] = useState('');

  useEffect(() => {
    if (!appointment.serviceId) return;
    listProviderOptionsAction({
      branchId: appointment.branchId,
      serviceId: appointment.serviceId,
    }).then((r) => setProviders(r.success ? r.data : []));
  }, [appointment.branchId, appointment.serviceId]);

  useEffect(() => {
    if (!providerId || !date || !appointment.serviceId) {
      setSlots([]);
      return;
    }
    setSlot('');
    listAvailableSlotsAction({
      branchId: appointment.branchId,
      serviceId: appointment.serviceId,
      providerId,
      date,
    }).then((r) => setSlots(r.success ? r.data : []));
  }, [providerId, date, appointment.branchId, appointment.serviceId]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateAppointmentAction({
        id: appointment.id,
        providerId: providerId || undefined,
        ...(slot ? { scheduledAt: slot } : {}),
        notes: String(fd.get('notes') ?? ''),
      });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم تحديث الحجز');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>تعديل الحجز</CardTitle>
        <CardDescription>
          تغيير مقدّم الخدمة أو الموعد. الفرع غير قابل للتعديل — يُلغى الحجز ويُنشأ غيره.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!canUpdate ? (
          <Alert variant="info" title="عرض فقط">
            لا تملك صلاحية تعديل الحجوزات.
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError ? (
              <Alert variant="danger" title="تعذّر التعديل">
                {formError}
              </Alert>
            ) : null}

            <Field label="مقدّم الخدمة">
              <Select value={providerId} onValueChange={setProviderId} disabled={pending}>
                <SelectTrigger aria-label="مقدّم الخدمة">
                  <SelectValue placeholder="اختر مقدّم الخدمة" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="موعد جديد" hint="اتركه فارغًا للإبقاء على الموعد الحالي">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
                className="w-44"
              />
              {date ? (
                slots.length === 0 ? (
                  <Alert variant="warning" title="لا أوقات متاحة" className="mt-2">
                    الفرع مغلق في هذا اليوم أو مواعيد مقدّم الخدمة كاملة.
                  </Alert>
                ) : (
                  <div className="mt-2 grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {slots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSlot(s)}
                        disabled={pending}
                        className={`rounded-md border px-2 py-1.5 text-xs tabular-nums ${
                          slot === s
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-muted'
                        }`}
                      >
                        {new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
                          timeZone: 'Asia/Riyadh',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(s))}
                      </button>
                    ))}
                  </div>
                )
              ) : null}
            </Field>

            <Field label="ملاحظات">
              <Textarea name="notes" rows={2} defaultValue={appointment.notes ?? ''} disabled={pending} />
            </Field>

            <Button type="submit" loading={pending}>
              <Save aria-hidden />
              حفظ التعديل
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * الحالة.
 * ⚠️ **لا قواعد انتقال**: كل الحالات المعرّفة متاحة دائمًا. قائمة الحالات
 *    وقواعد الانتقال بينها قرار عمل معلّق (P-11) ولن يُخترع هنا.
 */
function StatusCard({
  appointment,
  statuses,
  canUpdate,
  canCancel,
}: {
  appointment: AppointmentRow;
  statuses: readonly StatusOption[];
  canUpdate: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [statusId, setStatusId] = useState(appointment.statusId);

  function apply() {
    startTransition(async () => {
      const result = await setAppointmentStatusAction({ id: appointment.id, statusId });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success('تم تحديث الحالة');
      router.refresh();
    });
  }

  const target = statuses.find((s) => s.id === statusId);
  const allowed = target?.category === 'cancelled' ? canCancel : canUpdate;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" aria-hidden />
          حالة الحجز
        </CardTitle>
        <CardDescription>لا قواعد انتقال مفروضة — قائمة الحالات معلّقة (P-11).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">الحالة الحالية</span>
          <StatusBadge name={appointment.statusName} category={appointment.statusCategory} />
        </div>

        <Separator />

        <Field label="تغيير الحالة">
          <Select value={statusId} onValueChange={setStatusId} disabled={pending}>
            <SelectTrigger aria-label="تغيير الحالة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nameAr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {allowed ? (
          <Button
            block
            loading={pending}
            onClick={apply}
            disabled={statusId === appointment.statusId}
            variant={target?.category === 'cancelled' ? 'destructive' : 'primary'}
          >
            تطبيق الحالة
          </Button>
        ) : (
          <Alert variant="info" title="صلاحية ناقصة">
            {target?.category === 'cancelled'
              ? 'إلغاء الحجز يتطلب صلاحية appointments.cancel.'
              : 'تغيير الحالة يتطلب صلاحية appointments.update.'}
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          الحجز الملغى يحرّر وقت مقدّم الخدمة لغيره فورًا.
        </p>
      </CardContent>
    </Card>
  );
}

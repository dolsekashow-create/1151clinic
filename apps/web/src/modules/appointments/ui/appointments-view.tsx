'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock, CalendarDays, Clock, Plus, Search } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';
import type { AppointmentRow, BusinessHourRow, Option, StatusOption } from '../repository';
import {
  createAppointmentAction,
  listAvailableSlotsAction,
  listProviderOptionsAction,
  listServiceOptionsAction,
  searchCustomersAction,
} from '../actions';
import { BusinessHoursDrawer } from './business-hours-drawer';

const ALL = 'all';

export function AppointmentsView({
  result,
  error,
  branches,
  providers,
  statuses,
  hours,
  canCreate,
  canEditHours,
}: {
  result: Paginated<AppointmentRow> | null;
  error: ApiErrorShape | null;
  branches: readonly Option[];
  providers: readonly Option[];
  statuses: readonly StatusOption[];
  hours: readonly BusinessHourRow[];
  canCreate: boolean;
  canEditHours: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    // أي تغيير في المرشِّحات يعيد الترقيم للبداية
    if (!('page' in patch)) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const selectedBranch = params.get('branchId') ?? ALL;

  return (
    <div className="space-y-4">
      {statuses.length === 0 ? (
        <Alert variant="warning" title="لا توجد حالات حجز معرّفة">
          جدول حالات الحجز فارغ في هذه المنشأة، ولا يمكن إنشاء حجز بلا حالة. قائمة الحالات
          وقواعد الانتقال بينها قرار عمل معلّق (P-11) ولن تُنشأ تلقائيًا.
        </Alert>
      ) : null}

      {/* ------------------------------ المرشِّحات ------------------------------ */}
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            apply({ search: String(fd.get('search') ?? '') });
          }}
        >
          <Input
            name="search"
            defaultValue={params.get('search') ?? ''}
            placeholder="بحث باسم العميل أو هاتفه أو رقم الحجز…"
            className="w-64"
            aria-label="بحث"
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden />
            بحث
          </Button>
        </form>

        <Select value={selectedBranch} onValueChange={(v) => apply({ branchId: v, providerId: null })}>
          <SelectTrigger className="w-44" aria-label="تصفية حسب الفرع">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الفروع</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.get('providerId') ?? ALL}
          onValueChange={(v) => apply({ providerId: v })}
        >
          <SelectTrigger className="w-44" aria-label="تصفية حسب مقدّم الخدمة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل مقدّمي الخدمة</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={params.get('statusId') ?? ALL} onValueChange={(v) => apply({ statusId: v })}>
          <SelectTrigger className="w-36" aria-label="تصفية حسب الحالة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الحالات</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          className="w-40"
          aria-label="تصفية حسب التاريخ"
          defaultValue={params.get('date') ?? ''}
          onChange={(e) => apply({ date: e.target.value })}
        />

        {params.toString() ? (
          <Button variant="ghost" onClick={() => router.push(pathname)}>
            مسح المرشِّحات
          </Button>
        ) : null}

        <div className="ms-auto flex gap-2">
          {canEditHours ? <BusinessHoursDrawer branches={branches} hours={hours} /> : null}
          {canCreate && statuses.length > 0 ? (
            <CreateAppointmentDrawer branches={branches} statuses={statuses} />
          ) : null}
        </div>
      </div>

      {/* -------------------------------- الجدول -------------------------------- */}
      {error ? (
        <ErrorState description={error.message} />
      ) : !result || result.items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays aria-hidden />}
          title="لا توجد حجوزات"
          description="غيّر المرشِّحات أو أنشئ حجزًا جديدًا."
        />
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">الموعد ورقمه</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead className="w-40">الخدمة</TableHead>
                  <TableHead className="w-40">مقدّم الخدمة</TableHead>
                  <TableHead className="w-36">الفرع</TableHead>
                  <TableHead align="center" className="w-24">
                    المدة
                  </TableHead>
                  <TableHead align="center" className="w-28">
                    الحالة
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/app/appointments/${a.id}`} className="font-medium hover:underline">
                        <AppointmentTime instant={a.scheduledAt} />
                      </Link>
                      {a.referenceNo ? (
                        <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {a.referenceNo}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {a.customerName}
                      {a.customerPhone ? (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {a.customerPhone}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>{a.serviceName ?? '—'}</TableCell>
                    <TableCell>{a.providerName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{a.branchName}</TableCell>
                    <TableCell align="center" numeric>
                      {a.durationMinutes} د
                    </TableCell>
                    <TableCell align="center">
                      <StatusBadge name={a.statusName} category={a.statusCategory} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {result.meta.total > 0 ? (
            <Pagination
              page={result.meta.page}
              pageSize={result.meta.pageSize}
              total={result.meta.total}
              onPageChange={(page) => apply({ page: String(page) })}
              onPageSizeChange={(size) => apply({ pageSize: String(size), page: null })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export function StatusBadge({ name, category }: { name: string; category: string }) {
  const variant =
    category === 'done' ? 'success' : category === 'cancelled' ? 'danger' : 'primary';
  return <Badge variant={variant}>{name}</Badge>;
}

/** يعرض اللحظة بتوقيت الرياض صراحةً حتى لا تختلف عن الموعد الفعلي للفرع. */
export function AppointmentTime({ instant }: { instant: string }) {
  const formatted = useMemo(
    () =>
      new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
        timeZone: 'Asia/Riyadh',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(instant)),
    [instant],
  );
  return <span>{formatted}</span>;
}

/* ---------------------------- إنشاء حجز ---------------------------------- */

/**
 * نموذج الحجز.
 *
 * ⚠️ الأوقات المعروضة تأتي من `available_slots` في قاعدة البيانات، لا من حساب
 *    في المتصفح. أي منطق موازٍ هنا كان سينتج شاشة تعرض وقتًا يرفضه المحرّك.
 * ⚠️ لا حقل مدة: المدة تُشتق من الخدمة في المحرّك.
 */
function CreateAppointmentDrawer({
  branches,
  statuses,
}: {
  branches: readonly Option[];
  statuses: readonly StatusOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [services, setServices] = useState<readonly Option[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [providers, setProviders] = useState<readonly Option[]>([]);
  const [providerId, setProviderId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<readonly string[]>([]);
  const [slot, setSlot] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<ReadonlyArray<Option & { phone: string | null }>>([]);
  const [customerId, setCustomerId] = useState('');

  const openStatus = statuses.find((s) => s.category === 'open') ?? statuses[0];

  // الخدمات تتبع الفرع
  useEffect(() => {
    if (!branchId) return;
    setServiceId('');
    setProviderId('');
    setSlots([]);
    listServiceOptionsAction({ branchId }).then((r) => setServices(r.success ? r.data : []));
  }, [branchId]);

  // مقدّمو الخدمة يتبعون الخدمة والفرع معًا
  useEffect(() => {
    if (!branchId || !serviceId) {
      setProviders([]);
      return;
    }
    setProviderId('');
    setSlots([]);
    listProviderOptionsAction({ branchId, serviceId }).then((r) =>
      setProviders(r.success ? r.data : []),
    );
  }, [branchId, serviceId]);

  // الأوقات المتاحة تتبع المقدّم واليوم
  useEffect(() => {
    if (!branchId || !serviceId || !providerId || !date) {
      setSlots([]);
      return;
    }
    setSlot('');
    setLoadingSlots(true);
    listAvailableSlotsAction({ branchId, serviceId, providerId, date })
      .then((r) => setSlots(r.success ? r.data : []))
      .finally(() => setLoadingSlots(false));
  }, [branchId, serviceId, providerId, date]);

  // العملاء يتبعون الفرع والبحث
  useEffect(() => {
    if (!branchId) return;
    const timer = setTimeout(() => {
      searchCustomersAction({ branchId, search: customerSearch }).then((r) =>
        setCustomers(r.success ? r.data : []),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [branchId, customerSearch]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createAppointmentAction({
        branchId,
        customerId,
        serviceId,
        providerId,
        statusId: openStatus?.id ?? '',
        scheduledAt: slot,
        notes: String(fd.get('notes') ?? ''),
      });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم إنشاء الحجز');
      setOpen(false);
      setSlot('');
      setCustomerId('');
      router.refresh();
    });
  }

  const ready = branchId && customerId && serviceId && providerId && slot;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button>
          <Plus aria-hidden />
          حجز جديد
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="حجز جديد"
        description="الأوقات المعروضة متاحة فعلًا — تُحسب في قاعدة البيانات"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form="appointment-form" loading={pending} disabled={!ready}>
              حفظ الحجز
            </Button>
          </>
        }
      >
        <form id="appointment-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحجز">
              {formError}
            </Alert>
          ) : null}

          <Field label="الفرع" required>
            <Select value={branchId} onValueChange={setBranchId} disabled={pending}>
              <SelectTrigger aria-label="الفرع">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="العميل" required hint="عملاء هذا الفرع فقط">
            <Input
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الهاتف…"
              disabled={pending}
              aria-label="بحث عن عميل"
            />
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
              {customers.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">لا نتائج</p>
              ) : (
                customers.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="customer"
                      className="size-4 accent-[var(--color-primary)]"
                      checked={customerId === c.id}
                      onChange={() => setCustomerId(c.id)}
                      disabled={pending}
                    />
                    <span>{c.nameAr}</span>
                    {c.phone ? (
                      <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                        {c.phone}
                      </span>
                    ) : null}
                  </label>
                ))
              )}
            </div>
          </Field>

          <Field label="الخدمة" required hint="الخدمات المتاحة في هذا الفرع فقط">
            <Select value={serviceId} onValueChange={setServiceId} disabled={pending || !branchId}>
              <SelectTrigger aria-label="الخدمة">
                <SelectValue placeholder={services.length ? 'اختر الخدمة' : 'لا خدمات متاحة'} />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="مقدّم الخدمة"
            required
            hint="من يقدّم هذه الخدمة في هذا الفرع فقط"
          >
            <Select
              value={providerId}
              onValueChange={setProviderId}
              disabled={pending || !serviceId}
            >
              <SelectTrigger aria-label="مقدّم الخدمة">
                <SelectValue
                  placeholder={providers.length ? 'اختر مقدّم الخدمة' : 'لا مقدّم متاح لهذه الخدمة'}
                />
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

          <Field label="التاريخ" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending || !providerId}
            />
          </Field>

          <Field label="الوقت" required hint="الأوقات المشغولة وخارج الدوام غير معروضة">
            {!date || !providerId ? (
              <p className="text-sm text-muted-foreground">اختر مقدّم الخدمة والتاريخ أولًا.</p>
            ) : loadingSlots ? (
              <p className="text-sm text-muted-foreground">جارٍ حساب الأوقات المتاحة…</p>
            ) : slots.length === 0 ? (
              <Alert variant="warning" title="لا أوقات متاحة">
                إما أن الفرع مغلق في هذا اليوم، أو أن مواعيد مقدّم الخدمة كاملة.
              </Alert>
            ) : (
              <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlot(s)}
                    disabled={pending}
                    className={`rounded-md border px-2 py-1.5 text-xs tabular-nums transition-colors ${
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
            )}
          </Field>

          <Field label="ملاحظات">
            <Textarea name="notes" rows={2} disabled={pending} />
          </Field>

          <Alert variant="info" title="بلا overbooking">
            لا يمكن حجز وقت مشغول لمقدّم الخدمة نفسه، ولا الحجز خارج ساعات عمل الفرع. القاعدتان
            مفروضتان في قاعدة البيانات — حتى طلبان متزامنان لا ينجحان معًا.
          </Alert>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export { CalendarClock, Clock };

'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, MapPin, Pencil } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import type { AttendanceRow, BranchLocationRow, MonthlySummaryRow, OpenSession } from '../repository';
import { correctAttendanceAction, setBranchLocationAction } from '../actions';
import { AttendanceClock } from './attendance-clock';

const ALL = 'all';
const RIYADH = 'Asia/Riyadh';

export function AttendanceView({
  openSession,
  myBranches,
  sessions,
  error,
  summary,
  branches,
  locations,
  canViewAll,
  canManage,
  canEditLocations,
}: {
  openSession: OpenSession | null;
  myBranches: ReadonlyArray<{ id: string; nameAr: string }>;
  sessions: Paginated<AttendanceRow> | null;
  error: ApiErrorShape | null;
  summary: readonly MonthlySummaryRow[];
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
  locations: readonly BranchLocationRow[];
  canViewAll: boolean;
  canManage: boolean;
  canEditLocations: boolean;
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
    if (!('page' in patch)) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const unconfigured = locations.filter((l) => l.latitude === null || l.radiusMeters === null);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <AttendanceClock openSession={openSession} branches={myBranches} />
        </div>

        {canViewAll ? (
          <div className="lg:col-span-2">
            <MonthlyCard summary={summary} month={params.get('month')} onMonth={(m) => apply({ month: m })} />
          </div>
        ) : null}
      </div>

      {canEditLocations && unconfigured.length > 0 ? (
        <Alert variant="warning" title="فروع بلا موقع محدَّد">
          {unconfigured.length} فرع لا يقبل تسجيل حضور لأن موقعه أو نطاقه غير محدَّد:{' '}
          <strong>{unconfigured.map((l) => l.nameAr).join('، ')}</strong>. حدّدها من «مواقع الفروع».
        </Alert>
      ) : null}

      {canEditLocations ? <LocationsCard locations={locations} /> : null}

      {/* ------------------------------ السجل ------------------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>سجل الحضور</CardTitle>
              <CardDescription>
                {canViewAll ? 'سجلات موظفي فروعك.' : 'سجلك الشخصي — كل موظف يرى سجله دائمًا.'}
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              {canViewAll ? (
                <Select value={params.get('branchId') ?? ALL} onValueChange={(v) => apply({ branchId: v })}>
                  <SelectTrigger className="w-40" aria-label="تصفية حسب الفرع">
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
              ) : null}

              <Select value={params.get('status') ?? ALL} onValueChange={(v) => apply({ status: v })}>
                <SelectTrigger className="w-36" aria-label="تصفية حسب الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>كل الجلسات</SelectItem>
                  <SelectItem value="open">مفتوحة</SelectItem>
                  <SelectItem value="closed">مكتملة</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="date"
                className="w-36"
                aria-label="من تاريخ"
                defaultValue={params.get('from') ?? ''}
                onChange={(e) => apply({ from: e.target.value })}
              />
              <Input
                type="date"
                className="w-36"
                aria-label="إلى تاريخ"
                defaultValue={params.get('to') ?? ''}
                onChange={(e) => apply({ to: e.target.value })}
              />

              {params.toString() ? (
                <Button variant="ghost" onClick={() => router.push(pathname)}>
                  مسح
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {error ? (
            <ErrorState description={error.message} />
          ) : !sessions || sessions.items.length === 0 ? (
            <EmptyState
              icon={<MapPin aria-hidden />}
              title="لا توجد سجلات"
              description="ستظهر هنا بعد أول تسجيل حضور."
            />
          ) : (
            <>
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canViewAll ? <TableHead>الموظف</TableHead> : null}
                      <TableHead className="w-40">الحضور</TableHead>
                      <TableHead className="w-40">الانصراف</TableHead>
                      <TableHead align="center" className="w-24">
                        المدة
                      </TableHead>
                      <TableHead align="center" className="w-28">
                        بُعد الحضور
                      </TableHead>
                      <TableHead className="w-32">الفرع</TableHead>
                      {canManage ? (
                        <TableHead align="center" className="w-24">
                          تصحيح
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.items.map((s) => (
                      <TableRow key={s.id}>
                        {canViewAll ? <TableCell className="font-medium">{s.userName}</TableCell> : null}
                        <TableCell className="text-xs">{formatDateTime(s.checkedInAt)}</TableCell>
                        <TableCell className="text-xs">
                          {s.checkedOutAt ? (
                            formatDateTime(s.checkedOutAt)
                          ) : (
                            <Badge variant="warning" className="gap-1">
                              <AlertTriangle className="size-3" aria-hidden />
                              مفتوحة
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell align="center" numeric>
                          {s.durationMinutes === null ? '—' : formatDuration(s.durationMinutes)}
                        </TableCell>
                        <TableCell align="center" numeric>
                          {Math.round(s.checkInDistance)} م
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.branchName}</TableCell>
                        {canManage ? (
                          <TableCell align="center">
                            <CorrectionDrawer session={s} />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <div className="mt-3">
                <Pagination
                  page={sessions.meta.page}
                  pageSize={sessions.meta.pageSize}
                  total={sessions.meta.total}
                  onPageChange={(page) => apply({ page: String(page) })}
                  onPageSizeChange={(size) => apply({ pageSize: String(size), page: null })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- الملخّص الشهري ---------------------------- */

function MonthlyCard({
  summary,
  month,
  onMonth,
}: {
  summary: readonly MonthlySummaryRow[];
  month: string | null;
  onMonth: (value: string) => void;
}) {
  const current = month ?? new Date().toISOString().slice(0, 7);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>إجمالي الساعات الشهرية</CardTitle>
            <CardDescription>
              الجلسات المكتملة فقط. المفتوحة تُعدّ منفصلة ولا تدخل في المجموع.
            </CardDescription>
          </div>
          <Input
            type="month"
            className="w-40"
            aria-label="الشهر"
            value={current}
            onChange={(e) => onMonth(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا سجلات في هذا الشهر.</p>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead className="w-32">الفرع</TableHead>
                  <TableHead align="center" className="w-24">
                    الجلسات
                  </TableHead>
                  <TableHead align="center" className="w-28">
                    الإجمالي
                  </TableHead>
                  <TableHead align="center" className="w-24">
                    مفتوحة
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row) => (
                  <TableRow key={`${row.userId}-${row.branchId}`}>
                    <TableCell className="font-medium">{row.fullNameAr}</TableCell>
                    <TableCell className="text-muted-foreground">{row.branchName}</TableCell>
                    <TableCell align="center" numeric>
                      {row.sessionsCount}
                    </TableCell>
                    <TableCell align="center" numeric className="font-medium">
                      {formatDuration(row.totalMinutes)}
                    </TableCell>
                    <TableCell align="center">
                      {row.openSessions > 0 ? (
                        <Badge variant="warning">{row.openSessions}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- مواقع الفروع ------------------------------ */

/**
 * ⚠️ زر «استخدم موقعي الحالي» موجود لأن كتابة الإحداثيات يدويًا مصدر أخطاء
 *    شائع (تبديل خط الطول بالعرض). المدير يقف في المقر ويضغط الزر.
 */
function LocationsCard({ locations }: { locations: readonly BranchLocationRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>مواقع الفروع</CardTitle>
        <CardDescription>
          الفرع بلا إحداثيات أو بلا نصف قطر <strong>لا يقبل تسجيل حضور</strong>. الإتاحة قرار واعٍ.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفرع</TableHead>
                <TableHead align="center" className="w-40">
                  الإحداثيات
                </TableHead>
                <TableHead align="center" className="w-28">
                  النطاق
                </TableHead>
                <TableHead align="center" className="w-24">
                  إعداد
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.nameAr}</TableCell>
                  <TableCell align="center" className="font-mono text-xs" dir="ltr">
                    {l.latitude === null ? (
                      <Badge variant="neutral">غير محدَّد</Badge>
                    ) : (
                      `${l.latitude}, ${l.longitude}`
                    )}
                  </TableCell>
                  <TableCell align="center" numeric>
                    {l.radiusMeters === null ? '—' : `${l.radiusMeters} م`}
                  </TableCell>
                  <TableCell align="center">
                    <LocationDrawer location={l} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

function LocationDrawer({ location }: { location: BranchLocationRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState(location.latitude?.toString() ?? '');
  const [lng, setLng] = useState(location.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(location.radiusMeters?.toString() ?? '');
  const [locating, setLocating] = useState(false);

  function useMyLocation() {
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLng(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setError('تعذّر تحديد موقعك. فعّل خدمة الموقع أو أدخل الإحداثيات يدويًا.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await setBranchLocationAction({
        branchId: location.id,
        latitude: lat === '' ? null : Number(lat),
        longitude: lng === '' ? null : Number(lng),
        radiusMeters: radius === '' ? null : Number(radius),
      });
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      toast.success('تم حفظ موقع الفرع');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <MapPin className="size-3.5" aria-hidden />
          تحديد
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title={`موقع ${location.nameAr}`}
        description="يُستخدم للتحقق من وجود الموظف في المقر عند تسجيل الحضور"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button onClick={onSave} loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {error}
            </Alert>
          ) : null}

          <Button variant="outline" block onClick={useMyLocation} loading={locating} disabled={pending}>
            <MapPin aria-hidden />
            استخدم موقعي الحالي
          </Button>
          <p className="text-xs text-muted-foreground">
            قف داخل المقر واضغط الزر — أدق من كتابة الإحداثيات يدويًا.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="خط العرض" htmlFor={`lat-${location.id}`}>
              <Input
                id={`lat-${location.id}`}
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                dir="ltr"
                className="text-start"
                placeholder="24.711000"
                disabled={pending}
              />
            </Field>
            <Field label="خط الطول" htmlFor={`lng-${location.id}`}>
              <Input
                id={`lng-${location.id}`}
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                dir="ltr"
                className="text-start"
                placeholder="46.674000"
                disabled={pending}
              />
            </Field>
          </div>

          <Field
            label="نصف قطر النطاق (متر)"
            htmlFor={`radius-${location.id}`}
            hint="من 20 إلى 5000. الأصغر أدق لكنه قد يرفض موظفًا واقفًا عند الباب بسبب دقة GPS."
          >
            <Input
              id={`radius-${location.id}`}
              type="number"
              min={20}
              max={5000}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Alert variant="info" title="تركه فارغًا يعطّل الحضور">
            الفرع بلا إحداثيات أو بلا نطاق لا يقبل تسجيل حضور — لا يُسجَّل بلا تحقق.
          </Alert>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------- التصحيح -------------------------------- */

function CorrectionDrawer({ session }: { session: AttendanceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fd = new FormData(event.currentTarget);
    const checkedOut = String(fd.get('checkedOutAt') ?? '');

    startTransition(async () => {
      const result = await correctAttendanceAction({
        id: session.id,
        ...(checkedOut ? { checkedOutAt: new Date(checkedOut).toISOString() } : {}),
        notes: String(fd.get('notes') ?? ''),
      });
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      toast.success('تم تصحيح السجل');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <Pencil className="size-3.5" aria-hidden />
          تصحيح
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title={`تصحيح سجل ${session.userName}`}
        description="لإكمال جلسة نسي صاحبها الانصراف"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form={`correct-${session.id}`} loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <form id={`correct-${session.id}`} onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="danger" title="تعذّر التصحيح">
              {error}
            </Alert>
          ) : null}

          <Field label="وقت الحضور المسجّل">
            <Input value={formatDateTime(session.checkedInAt)} disabled readOnly />
          </Field>

          <Field
            label="وقت الانصراف"
            htmlFor={`out-${session.id}`}
            hint="يجب أن يكون بعد وقت الحضور"
          >
            <Input id={`out-${session.id}`} name="checkedOutAt" type="datetime-local" disabled={pending} />
          </Field>

          <Field label="سبب التصحيح" htmlFor={`notes-${session.id}`}>
            <Textarea
              id={`notes-${session.id}`}
              name="notes"
              rows={2}
              defaultValue={session.notes ?? ''}
              disabled={pending}
            />
          </Field>

          <Alert variant="warning" title="وقت الحضور غير قابل للتعديل">
            تغييره يمحو الواقعة المسجّلة بالموقع. القابل للتصحيح هو الانصراف الناقص فقط، ولا يمكن
            لأحد تصحيح سجل نفسه.
          </Alert>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------- تنسيق --------------------------------- */

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    timeZone: RIYADH,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} د`;
  return `${h} س ${m} د`;
}

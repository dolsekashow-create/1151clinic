'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@erp/ui';
import type { BusinessHourRow, Option } from '../repository';
import { setBusinessHoursAction } from '../actions';
import { WEEKDAY_NAMES } from '../schemas';

interface Period {
  weekday: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/**
 * محرّر ساعات عمل الفرع.
 *
 * ⚠️ نظام بسيط عمدًا: صف = فترة في يوم. عدة صفوف لنفس اليوم = عدة فترات
 *    (صباحية/مسائية) بلا أي تغيير بنيوي. ليس نظام ورديات ولا يحمل موظفين.
 * ⚠️ فرع بلا ساعات = مغلق: لا حجز فيه إطلاقًا. هذا الاتجاه متعمّد — الإتاحة
 *    قرار واعٍ لا نتيجة صمت، كما في نظام النشر.
 */
export function BusinessHoursDrawer({
  branches,
  hours,
}: {
  branches: readonly Option[];
  hours: readonly BusinessHourRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const initialBranch = params.get('branchId') ?? branches[0]?.id ?? '';
  const [branchId, setBranchId] = useState(initialBranch);
  const [periods, setPeriods] = useState<Period[]>(() =>
    hours.map((h) => ({
      weekday: h.weekday,
      opensAt: h.opensAt,
      closesAt: h.closesAt,
      isClosed: h.isClosed,
    })),
  );

  function addPeriod() {
    setPeriods((prev) => [...prev, { weekday: 0, opensAt: '08:00', closesAt: '17:00', isClosed: false }]);
  }

  function update(index: number, patch: Partial<Period>) {
    setPeriods((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await setBusinessHoursAction({ branchId, periods });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم حفظ ساعات العمل');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <Clock aria-hidden />
          ساعات العمل
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="ساعات عمل الفرع"
        description="تُستخدم لتحديد الأوقات المتاحة ومنع الحجز خارج الدوام"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form="hours-form" loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <form id="hours-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          <Field label="الفرع" required hint="افتح المحرّر بعد اختيار الفرع من مرشِّح الصفحة لتحميل ساعاته">
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

          <div className="space-y-2">
            {periods.length === 0 ? (
              <Alert variant="warning" title="لا ساعات عمل">
                هذا الفرع مغلق بالكامل حاليًا ولا يمكن الحجز فيه. أضف فترة واحدة على الأقل.
              </Alert>
            ) : null}

            {periods.map((p, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                <label className="flex-1">
                  <span className="mb-1 block text-xs text-muted-foreground">اليوم</span>
                  <Select
                    value={String(p.weekday)}
                    onValueChange={(v) => update(i, { weekday: Number(v) })}
                    disabled={pending}
                  >
                    <SelectTrigger aria-label="اليوم">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_NAMES.map((name, index) => (
                        <SelectItem key={name} value={String(index)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label>
                  <span className="mb-1 block text-xs text-muted-foreground">من</span>
                  <Input
                    type="time"
                    value={p.opensAt}
                    onChange={(e) => update(i, { opensAt: e.target.value })}
                    disabled={pending || p.isClosed}
                    className="w-28"
                  />
                </label>

                <label>
                  <span className="mb-1 block text-xs text-muted-foreground">إلى</span>
                  <Input
                    type="time"
                    value={p.closesAt}
                    onChange={(e) => update(i, { closesAt: e.target.value })}
                    disabled={pending || p.isClosed}
                    className="w-28"
                  />
                </label>

                <label className="flex items-center gap-1.5 pb-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={p.isClosed}
                    onChange={(e) => update(i, { isClosed: e.target.checked })}
                    disabled={pending}
                  />
                  مغلق
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPeriods((prev) => prev.filter((_, index) => index !== i))}
                  disabled={pending}
                  title="حذف الفترة"
                >
                  <Trash2 aria-label="حذف الفترة" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addPeriod} disabled={pending}>
              <Plus aria-hidden />
              إضافة فترة
            </Button>
          </div>

          <Alert variant="info" title="عدة فترات في اليوم">
            أضف صفّين لنفس اليوم لتمثيل دوام صباحي ومسائي. الأوقات بتوقيت الفرع المحلي.
          </Alert>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

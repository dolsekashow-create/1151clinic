'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@erp/ui';
import { listBusinessHoursAction, setBusinessHoursAction } from '../actions';
import { WEEKDAY_NAMES } from '../schemas';

interface Period {
  weekday: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/**
 * محرّر ساعات عمل فرع واحد — يُفتح من صف الفرع في شاشة الفروع.
 *
 * ⚠️ يشترك مع شاشة الحجوزات في **نفس الفعل** `setBusinessHoursAction` ونفس
 *    قواعد التحقق. لا نسخة ثانية من المنطق: أي اختلاف بينهما كان سيُنتج
 *    ساعات تُقبل من شاشة وتُرفض من أخرى.
 * ⚠️ التحميل عند الفتح لا مع الجدول: تحميل ساعات كل فرع مسبقًا يعني استعلامًا
 *    لكل صف.
 * ⚠️ فرع بلا فترات = مغلق تمامًا ولا يقبل حجزًا (قرار معتمد 2026-08-17).
 */
export function BranchHoursDrawer({
  branchId,
  branchName,
  canEdit,
}: {
  branchId: string;
  branchName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFormError(null);
    listBusinessHoursAction({ id: branchId })
      .then((result) => {
        if (!result.success) {
          setFormError(result.error.message);
          return;
        }
        setPeriods(
          result.data.map((h) => ({
            weekday: h.weekday,
            opensAt: h.opensAt,
            closesAt: h.closesAt,
            isClosed: h.isClosed,
          })),
        );
      })
      .finally(() => setLoading(false));
  }, [open, branchId]);

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

  const formId = `hours-${branchId}`;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" title="ساعات العمل">
          <Clock className="size-3.5" aria-hidden />
          الساعات
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title={`ساعات عمل ${branchName}`}
        description="تحدّد الأوقات المتاحة للحجز وتمنع الحجز خارج الدوام"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            {canEdit ? (
              <Button type="submit" form={formId} loading={pending} disabled={loading}>
                حفظ
              </Button>
            ) : null}
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          {!canEdit ? (
            <Alert variant="info" title="عرض فقط">
              تعديل ساعات العمل يتطلب صلاحية <code>organizations.branches.update</code>.
            </Alert>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : (
            <>
              {periods.length === 0 ? (
                <Alert variant="warning" title="الفرع مغلق">
                  لا توجد ساعات عمل، فلا يمكن الحجز في هذا الفرع إطلاقًا. أضف فترة واحدة على الأقل.
                </Alert>
              ) : null}

              <div className="space-y-2">
                {periods.map((p, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
                  >
                    <label className="flex-1">
                      <span className="mb-1 block text-xs text-muted-foreground">اليوم</span>
                      <Select
                        value={String(p.weekday)}
                        onValueChange={(v) => update(i, { weekday: Number(v) })}
                        disabled={pending || !canEdit}
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
                        disabled={pending || p.isClosed || !canEdit}
                        className="w-28"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs text-muted-foreground">إلى</span>
                      <Input
                        type="time"
                        value={p.closesAt}
                        onChange={(e) => update(i, { closesAt: e.target.value })}
                        disabled={pending || p.isClosed || !canEdit}
                        className="w-28"
                      />
                    </label>

                    <label className="flex items-center gap-1.5 pb-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={p.isClosed}
                        onChange={(e) => update(i, { isClosed: e.target.checked })}
                        disabled={pending || !canEdit}
                      />
                      مغلق
                    </label>

                    {canEdit ? (
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
                    ) : null}
                  </div>
                ))}

                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPeriods((prev) => [
                        ...prev,
                        { weekday: 0, opensAt: '08:00', closesAt: '17:00', isClosed: false },
                      ])
                    }
                    disabled={pending}
                  >
                    <Plus aria-hidden />
                    إضافة فترة
                  </Button>
                ) : null}
              </div>

              <Alert variant="info" title="عدة فترات في اليوم">
                أضف صفّين لنفس اليوم لتمثيل دوام صباحي ومسائي. الأوقات بتوقيت الفرع المحلي.
              </Alert>
            </>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  );
}

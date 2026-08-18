'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import {
  Alert,
  Badge,
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
  TableCell,
  TableRow,
  Textarea,
  toast,
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';
import { AdminResourceTable, type AdminColumn } from '@/shared/components/admin-resource-table';
import { PublishToggle } from '@/shared/components/publish-toggle';
import { BranchHoursDrawer } from '@/modules/appointments/ui/branch-hours-drawer';
import { DeleteButton } from '@/shared/components/delete-button';
import { archiveRecordAction } from '@/modules/shared/archive';
import type { BranchRow } from '../repository';
import { createBranchAction, setBranchPublishAction, updateBranchAction } from '../actions';

const COLUMNS: readonly AdminColumn[] = [
  { key: 'code', label: 'الكود', width: 'w-24' },
  { key: 'name', label: 'اسم الفرع' },
  { key: 'city', label: 'المدينة', width: 'w-28' },
  { key: 'phone', label: 'الهاتف', width: 'w-32' },
  { key: 'status', label: 'الحالة', align: 'center', width: 'w-24' },
  { key: 'public', label: 'الموقع العام', align: 'center', width: 'w-28' },
  { key: 'actions', label: 'إجراءات', align: 'center', width: 'w-56' },
];

export interface BranchesViewProps {
  result: Paginated<BranchRow> | null;
  error: ApiErrorShape | null;
  canCreate: boolean;
  canUpdate: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

export function BranchesView({
  result,
  error,
  canCreate,
  canUpdate,
  canPublish,
  canDelete,
}: BranchesViewProps) {
  return (
    <>
      {canPublish ? (
        <Alert variant="info" title="النشر على الموقع العام">
          الفرع لا يظهر للزوار إلا إذا كان <strong>منشورًا</strong> و<strong>نشطًا</strong> و
          <strong>المنشأة نفسها منشورة</strong>. الافتراضي غير منشور.
        </Alert>
      ) : null}

      <AdminResourceTable<BranchRow>
        result={result}
        error={error}
        columns={COLUMNS}
        searchPlaceholder="بحث بالاسم أو الكود أو المدينة…"
        emptyTitle="لا توجد فروع"
        emptyDescription="ابدأ بإضافة أول فرع للمنشأة."
        showPublishFilter
        actions={canCreate ? <BranchFormDrawer mode="create" /> : null}
        renderRow={(branch) => (
          <TableRow key={branch.id}>
            <TableCell className="font-mono text-xs" dir="ltr">
              {branch.code}
            </TableCell>
            <TableCell className="font-medium">{branch.nameAr}</TableCell>
            <TableCell className="text-muted-foreground">{branch.city ?? '—'}</TableCell>
            <TableCell numeric dir="ltr" className="text-end">
              {branch.phone ?? '—'}
            </TableCell>
            <TableCell align="center">
              <Badge variant={branch.status === 'active' ? 'success' : 'neutral'}>
                {branch.status === 'active' ? 'نشط' : 'غير نشط'}
              </Badge>
            </TableCell>
            <TableCell align="center">
              <PublishToggle
                id={branch.id}
                isPublic={branch.isPublic}
                canPublish={canPublish}
                action={setBranchPublishAction}
              />
            </TableCell>
            <TableCell align="center">
              <div className="flex items-center justify-center gap-1">
                {canUpdate ? <BranchFormDrawer mode="edit" branch={branch} /> : null}
                {/* ساعات العمل إعداد فرع ⇒ مكانها هنا. المحرّر نفسه المستخدم
                    في شاشة الحجوزات — لا نسخة ثانية منه. */}
                <BranchHoursDrawer branchId={branch.id} branchName={branch.nameAr} canEdit={canUpdate} />
                {canDelete ? (
                  <DeleteButton
                    label={branch.nameAr}
                    entityLabel="الفرع"
                    onDelete={() => archiveRecordAction({ entity: 'branch', id: branch.id })}
                  />
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        )}
      />
    </>
  );
}

/**
 * نموذج الفرع — إنشاء وتعديل بنفس الحقول.
 *
 * ⚠️ نموذج واحد لا نموذجان: أي حقل يُضاف لاحقًا في أحدهما دون الآخر يُنتج
 *    فرعًا يُنشأ ببيانات ناقصة لا يمكن استكمالها إلا بـSQL.
 * ⚠️ `isPublic` ليس هنا عمدًا — فعل منفصل بصلاحية منفصلة ومحفّز يفرضها.
 */
function BranchFormDrawer({ mode, branch }: { mode: 'create' | 'edit'; branch?: BranchRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState(branch?.status ?? 'active');

  const isEdit = mode === 'edit';
  const formId = `branch-form-${branch?.id ?? 'new'}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    const payload = {
      code: String(fd.get('code') ?? ''),
      nameAr: String(fd.get('nameAr') ?? ''),
      nameEn: String(fd.get('nameEn') ?? ''),
      city: String(fd.get('city') ?? ''),
      phone: String(fd.get('phone') ?? ''),
      address: String(fd.get('address') ?? ''),
      timezone: String(fd.get('timezone') ?? 'Asia/Riyadh'),
    };

    startTransition(async () => {
      const result =
        isEdit && branch
          ? await updateBranchAction({ ...payload, id: branch.id, status })
          : await createBranchAction(payload);

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success(isEdit ? 'تم حفظ التعديل' : 'تم إنشاء الفرع — غير منشور على الموقع العام');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" title="تعديل الفرع">
            <Pencil className="size-3.5" aria-hidden />
            تعديل
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            فرع جديد
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent
        title={isEdit ? `تعديل ${branch?.nameAr}` : 'إضافة فرع'}
        description={
          isEdit
            ? 'تغيير الحالة إلى «غير نشط» يُخفي الفرع من الموقع العام ومن الحجز'
            : 'الفرع يُنشأ غير منشور — النشر خطوة منفصلة بصلاحية منفصلة'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          <Field label="الكود" required htmlFor={`${formId}-code`} error={fieldErrors.code?.[0]} hint="مثال: RYD-06">
            <Input
              id={`${formId}-code`}
              name="code"
              defaultValue={branch?.code ?? ''}
              dir="ltr"
              className="text-start"
              required
              disabled={pending}
            />
          </Field>

          <Field label="اسم الفرع" required htmlFor={`${formId}-nameAr`} error={fieldErrors.nameAr?.[0]}>
            <Input id={`${formId}-nameAr`} name="nameAr" defaultValue={branch?.nameAr ?? ''} required disabled={pending} />
          </Field>

          <Field label="الاسم بالإنجليزية" htmlFor={`${formId}-nameEn`} error={fieldErrors.nameEn?.[0]}>
            <Input
              id={`${formId}-nameEn`}
              name="nameEn"
              defaultValue={branch?.nameEn ?? ''}
              dir="ltr"
              className="text-start"
              disabled={pending}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المدينة" htmlFor={`${formId}-city`} error={fieldErrors.city?.[0]}>
              <Input id={`${formId}-city`} name="city" defaultValue={branch?.city ?? ''} disabled={pending} />
            </Field>
            <Field label="الهاتف" htmlFor={`${formId}-phone`} error={fieldErrors.phone?.[0]}>
              <Input
                id={`${formId}-phone`}
                name="phone"
                defaultValue={branch?.phone ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending}
              />
            </Field>
          </div>

          <Field label="العنوان" htmlFor={`${formId}-address`} error={fieldErrors.address?.[0]}>
            <Textarea id={`${formId}-address`} name="address" rows={2} defaultValue={branch?.address ?? ''} disabled={pending} />
          </Field>

          <Field
            label="المنطقة الزمنية"
            htmlFor={`${formId}-timezone`}
            error={fieldErrors.timezone?.[0]}
            hint="تُحسب بها ساعات العمل وأوقات الحجز"
          >
            <Input
              id={`${formId}-timezone`}
              name="timezone"
              defaultValue={branch?.timezone ?? 'Asia/Riyadh'}
              dir="ltr"
              className="text-start"
              disabled={pending}
            />
          </Field>

          {isEdit ? (
            <Field label="الحالة" hint="الفرع غير النشط لا يظهر للزوار ولا يقبل حجزًا">
              <Select value={status} onValueChange={setStatus} disabled={pending}>
                <SelectTrigger aria-label="الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="inactive">غير نشط</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </form>
      </DrawerContent>
    </Drawer>
  );
}

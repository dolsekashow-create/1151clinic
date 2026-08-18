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
  toast,
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';
import { AdminResourceTable, type AdminColumn } from '@/shared/components/admin-resource-table';
import type { DepartmentRow } from '../repository';
import { createDepartmentAction, updateDepartmentAction } from '../actions';
import { DeleteButton } from '@/shared/components/delete-button';
import { archiveRecordAction } from '@/modules/shared/archive';

const COLUMNS: readonly AdminColumn[] = [
  { key: 'code', label: 'الكود', width: 'w-36' },
  { key: 'name', label: 'القسم' },
  { key: 'scope', label: 'النطاق', width: 'w-40' },
  { key: 'status', label: 'الحالة', align: 'center', width: 'w-24' },
  { key: 'actions', label: 'إجراءات', align: 'center', width: 'w-40' },
];

export interface DepartmentsViewProps {
  result: Paginated<DepartmentRow> | null;
  error: ApiErrorShape | null;
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
  canManage: boolean;
  canDelete: boolean;
  hasOrgScope: boolean;
}

export function DepartmentsView({
  result,
  error,
  branches,
  canManage,
  canDelete,
  hasOrgScope,
}: DepartmentsViewProps) {
  const branchName = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.nameAr ?? '—') : null;

  return (
    <>
      <Alert variant="info" title="القسم المركزي مقابل قسم الفرع">
        القسم بلا فرع يُعتبر <strong>مركزيًا على مستوى المنشأة</strong> ويقرأه موظفو كل الفروع.
        إنشاؤه يتطلب نطاق منشأة.
      </Alert>

      <AdminResourceTable<DepartmentRow>
        result={result}
        error={error}
        columns={COLUMNS}
        searchPlaceholder="بحث بالاسم أو الكود…"
        emptyTitle="لا توجد أقسام"
        emptyDescription="ابدأ بإضافة أول قسم."
        actions={
          canManage ? (
            <DepartmentFormDrawer mode="create" branches={branches} hasOrgScope={hasOrgScope} />
          ) : null
        }
        renderRow={(department) => (
          <TableRow key={department.id}>
            <TableCell className="font-mono text-xs" dir="ltr">
              {department.code}
            </TableCell>
            <TableCell className="font-medium">{department.nameAr}</TableCell>
            <TableCell>
              {department.branchId ? (
                <span className="text-muted-foreground">{branchName(department.branchId)}</span>
              ) : (
                <Badge variant="primary">مركزي</Badge>
              )}
            </TableCell>
            <TableCell align="center">
              <Badge variant={department.status === 'active' ? 'success' : 'neutral'}>
                {department.status === 'active' ? 'نشط' : 'غير نشط'}
              </Badge>
            </TableCell>
            <TableCell align="center">
              <div className="flex items-center justify-center gap-1">
                {canManage ? (
                  <DepartmentFormDrawer
                    mode="edit"
                    department={department}
                    branches={branches}
                    hasOrgScope={hasOrgScope}
                  />
                ) : null}
                {canDelete ? (
                  <DeleteButton
                    label={department.nameAr}
                    entityLabel="القسم"
                    onDelete={() => archiveRecordAction({ entity: 'department', id: department.id })}
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

function DepartmentFormDrawer({
  mode,
  department,
  branches,
  hasOrgScope,
}: {
  mode: 'create' | 'edit';
  department?: DepartmentRow;
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
  hasOrgScope: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isEdit = mode === 'edit';
  const formId = `dept-form-${department?.id ?? 'new'}`;
  const [scope, setScope] = useState<string>(
    department ? (department.branchId ?? 'central') : hasOrgScope ? 'central' : (branches[0]?.id ?? ''),
  );
  const [status, setStatus] = useState(department?.status ?? 'active');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    const payload = {
      code: String(fd.get('code') ?? ''),
      nameAr: String(fd.get('nameAr') ?? ''),
      branchId: scope === 'central' ? null : scope,
    };

    startTransition(async () => {
      const result =
        isEdit && department
          ? await updateDepartmentAction({ ...payload, id: department.id, status })
          : await createDepartmentAction(payload);

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as { fieldErrors?: Record<string, string[]> } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success(isEdit ? 'تم حفظ التعديل' : 'تم إنشاء القسم');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" title="تعديل القسم">
            <Pencil className="size-3.5" aria-hidden />
            تعديل
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            قسم جديد
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent
        title={isEdit ? `تعديل ${department?.nameAr}` : 'إضافة قسم'}
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

          <Field label="النطاق" required htmlFor="scope">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="scope">
                <SelectValue placeholder="اختر النطاق" />
              </SelectTrigger>
              <SelectContent>
                {hasOrgScope ? <SelectItem value="central">مركزي (كل الفروع)</SelectItem> : null}
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="الكود" required htmlFor={`${formId}-code`} error={fieldErrors.code?.[0]} hint="مثال: LAB">
            <Input
              id={`${formId}-code`}
              name="code"
              defaultValue={department?.code ?? ''}
              dir="ltr"
              className="text-start"
              required
              disabled={pending}
            />
          </Field>
          <Field label="اسم القسم" required htmlFor={`${formId}-nameAr`} error={fieldErrors.nameAr?.[0]}>
            <Input
              id={`${formId}-nameAr`}
              name="nameAr"
              defaultValue={department?.nameAr ?? ''}
              required
              disabled={pending}
            />
          </Field>

          {isEdit ? (
            <Field label="الحالة">
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

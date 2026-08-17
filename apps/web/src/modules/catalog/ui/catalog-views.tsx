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
import { LinkEditorDrawer } from '@/shared/components/link-editor-drawer';
import type { ProviderRow, ServiceRow } from '../repository';
import {
  createProviderAction,
  createServiceAction,
  listProviderBranchStateAction,
  listProviderServiceStateAction,
  listServiceBranchStateAction,
  setProviderBranchesAction,
  setProviderPublishAction,
  setProviderServicesAction,
  setServiceBranchesAction,
  setServicePublishAction,
  updateProviderAction,
  updateServiceAction,
} from '../actions';

const PUBLISH_NOTE = (
  <Alert variant="info" title="النشر على الموقع العام">
    لا يظهر العنصر للزوار إلا إذا كان <strong>منشورًا</strong> و<strong>نشطًا</strong> و
    <strong>المنشأة نفسها منشورة</strong>. الافتراضي غير منشور.
  </Alert>
);

/* ------------------------------- الخدمات ---------------------------------- */

const SERVICE_COLUMNS: readonly AdminColumn[] = [
  { key: 'code', label: 'الكود', width: 'w-28' },
  { key: 'name', label: 'الخدمة' },
  { key: 'scope', label: 'النطاق', width: 'w-24' },
  { key: 'duration', label: 'المدة', align: 'center', width: 'w-20' },
  { key: 'status', label: 'الحالة', align: 'center', width: 'w-24' },
  { key: 'public', label: 'الموقع العام', align: 'center', width: 'w-28' },
  { key: 'actions', label: 'إجراءات', align: 'center', width: 'w-44' },
];

export function ServicesView({
  result,
  error,
  canCreate,
  canUpdate,
  canPublish,
}: {
  result: Paginated<ServiceRow> | null;
  error: ApiErrorShape | null;
  canCreate: boolean;
  canUpdate: boolean;
  canPublish: boolean;
}) {
  return (
    <>
      {canPublish ? PUBLISH_NOTE : null}
      <AdminResourceTable<ServiceRow>
        result={result}
        error={error}
        columns={SERVICE_COLUMNS}
        searchPlaceholder="بحث بالاسم أو الكود…"
        emptyTitle="لا توجد خدمات"
        emptyDescription="ابدأ بإضافة أول خدمة."
        showPublishFilter
        actions={canCreate ? <ServiceFormDrawer mode="create" /> : null}
        renderRow={(service) => (
          <TableRow key={service.id}>
            <TableCell className="font-mono text-xs" dir="ltr">
              {service.code}
            </TableCell>
            <TableCell className="font-medium">{service.nameAr}</TableCell>
            <TableCell>
              <Badge variant={service.branchId ? 'neutral' : 'primary'}>
                {service.branchId ? 'فرع محدد' : 'مشتركة'}
              </Badge>
            </TableCell>
            <TableCell align="center" numeric>
              {service.durationMinutes ? `${service.durationMinutes} د` : '—'}
            </TableCell>
            <TableCell align="center">
              <Badge variant={service.status === 'active' ? 'success' : 'neutral'}>
                {service.status === 'active' ? 'نشط' : 'غير نشط'}
              </Badge>
            </TableCell>
            <TableCell align="center">
              <PublishToggle
                id={service.id}
                isPublic={service.isPublic}
                canPublish={canPublish}
                action={setServicePublishAction}
              />
            </TableCell>
            <TableCell align="center">
              <div className="flex items-center justify-center gap-1">
                {canUpdate ? <ServiceFormDrawer mode="edit" service={service} /> : null}
                {/* الخدمة المشتركة تحتاج إتاحة صريحة في كل فرع — بدونها لا
                    يقبلها محفّز الحجز. الخدمة الخاصة بفرع متاحة فيه بحكم انتمائها. */}
                {service.branchId === null ? (
                  <LinkEditorDrawer
                    label="الفروع"
                    title={`إتاحة «${service.nameAr}» في الفروع`}
                    description="الخدمة المشتركة لا تُحجز في فرع إلا إذا كانت متاحة فيه"
                    entityId={service.id}
                    disabled={!canUpdate}
                    load={listServiceBranchStateAction}
                    save={(branchIds) => setServiceBranchesAction({ serviceId: service.id, branchIds })}
                    emptyWarning="الخدمة لن تكون متاحة للحجز في أي فرع."
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
 * نموذج الخدمة — إنشاء وتعديل بنفس الحقول.
 * ⚠️ لا حقل سعر ولن يوجد: P-14 معلّقة.
 */
function ServiceFormDrawer({ mode, service }: { mode: 'create' | 'edit'; service?: ServiceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState(service?.status ?? 'active');

  const isEdit = mode === 'edit';
  const formId = `service-form-${service?.id ?? 'new'}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);
    const duration = String(fd.get('durationMinutes') ?? '').trim();

    const payload = {
      code: String(fd.get('code') ?? ''),
      nameAr: String(fd.get('nameAr') ?? ''),
      description: String(fd.get('description') ?? ''),
      ...(duration ? { durationMinutes: duration } : {}),
    };

    startTransition(async () => {
      const result =
        isEdit && service
          ? await updateServiceAction({ ...payload, id: service.id, status })
          : await createServiceAction({ ...payload, branchId: null });

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success(isEdit ? 'تم حفظ التعديل' : 'تم إنشاء الخدمة — غير منشورة');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" title="تعديل الخدمة">
            <Pencil className="size-3.5" aria-hidden />
            تعديل
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            خدمة جديدة
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent
        title={isEdit ? `تعديل ${service?.nameAr}` : 'إضافة خدمة'}
        description={
          isEdit
            ? 'تغيير المدة يؤثر على الحجوزات الجديدة فقط — القائمة تحتفظ بمدتها'
            : 'تُنشأ مشتركة على مستوى المنشأة وغير منشورة'
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

          <Field label="الكود" required htmlFor={`${formId}-code`} error={fieldErrors.code?.[0]} hint="مثال: SVC-XRAY">
            <Input
              id={`${formId}-code`}
              name="code"
              defaultValue={service?.code ?? ''}
              dir="ltr"
              className="text-start"
              required
              disabled={pending}
            />
          </Field>

          <Field label="اسم الخدمة" required htmlFor={`${formId}-nameAr`} error={fieldErrors.nameAr?.[0]}>
            <Input id={`${formId}-nameAr`} name="nameAr" defaultValue={service?.nameAr ?? ''} required disabled={pending} />
          </Field>

          <Field
            label="المدة بالدقائق"
            htmlFor={`${formId}-durationMinutes`}
            error={fieldErrors.durationMinutes?.[0]}
            hint="مدة الحجز تُشتق منها — الخدمة بلا مدة لا تظهر في نموذج الحجز"
          >
            <Input
              id={`${formId}-durationMinutes`}
              name="durationMinutes"
              type="number"
              min={5}
              max={600}
              defaultValue={service?.durationMinutes ?? ''}
              disabled={pending}
            />
          </Field>

          <Field label="الوصف" htmlFor={`${formId}-description`} error={fieldErrors.description?.[0]}>
            <Textarea
              id={`${formId}-description`}
              name="description"
              rows={3}
              defaultValue={service?.description ?? ''}
              disabled={pending}
            />
          </Field>

          {isEdit ? (
            <Field label="الحالة" hint="الخدمة غير النشطة لا تظهر للزوار ولا تُحجز">
              <Select value={status} onValueChange={setStatus} disabled={pending}>
                <SelectTrigger aria-label="الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشطة</SelectItem>
                  <SelectItem value="inactive">غير نشطة</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Alert variant="info" title="بلا أسعار">
            التسعير والخصومات والباقات قواعد عمل غير معتمدة بعد (P-14)، فلا يوجد حقل سعر.
          </Alert>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/* --------------------------- مقدّمو الخدمة -------------------------------- */

const PROVIDER_COLUMNS: readonly AdminColumn[] = [
  { key: 'code', label: 'الكود', width: 'w-24' },
  { key: 'name', label: 'مقدّم الخدمة' },
  { key: 'specialty', label: 'التخصص', width: 'w-32' },
  { key: 'account', label: 'حساب النظام', align: 'center', width: 'w-28' },
  { key: 'status', label: 'الحالة', align: 'center', width: 'w-24' },
  { key: 'public', label: 'الموقع العام', align: 'center', width: 'w-28' },
  { key: 'actions', label: 'إجراءات', align: 'center', width: 'w-56' },
];

export function ProvidersView({
  result,
  error,
  canCreate,
  canManage,
  canPublish,
}: {
  result: Paginated<ProviderRow> | null;
  error: ApiErrorShape | null;
  canCreate: boolean;
  canManage: boolean;
  canPublish: boolean;
}) {
  return (
    <>
      <Alert variant="info" title="مقدّم الخدمة كيان مستقل">
        حساب الدخول <strong>اختياري</strong>: الطبيب يوجد في النظام ويُرتبط بالحجوزات بلا حساب
        مصادقة. الحساب يُربط فقط لمن يحتاج تسجيل الدخول، من شاشة المستخدمين.
      </Alert>
      <Alert variant="warning" title="الربط شرط الحجز">
        لا يظهر مقدّم الخدمة في نموذج الحجز إلا إذا كان مربوطًا <strong>بالفرع</strong> و
        <strong>بالخدمة</strong> معًا. غياب الربط يعني عدم التوفّر — وهو قرار معتمد لا خطأ.
      </Alert>

      <AdminResourceTable<ProviderRow>
        result={result}
        error={error}
        columns={PROVIDER_COLUMNS}
        searchPlaceholder="بحث بالاسم أو التخصص أو الكود…"
        emptyTitle="لا يوجد مقدّمو خدمة"
        emptyDescription="ابدأ بإضافة أول طبيب أو مقدّم خدمة."
        showPublishFilter
        actions={canCreate ? <ProviderFormDrawer mode="create" /> : null}
        renderRow={(provider) => (
          <TableRow key={provider.id}>
            <TableCell className="font-mono text-xs" dir="ltr">
              {provider.code}
            </TableCell>
            <TableCell className="font-medium">{provider.nameAr}</TableCell>
            <TableCell className="text-muted-foreground">{provider.specialty ?? '—'}</TableCell>
            <TableCell align="center">
              <Badge variant={provider.profileId ? 'primary' : 'neutral'}>
                {provider.profileId ? 'مرتبط' : 'بلا حساب'}
              </Badge>
            </TableCell>
            <TableCell align="center">
              <Badge variant={provider.status === 'active' ? 'success' : 'neutral'}>
                {provider.status === 'active' ? 'نشط' : 'غير نشط'}
              </Badge>
            </TableCell>
            <TableCell align="center">
              <PublishToggle
                id={provider.id}
                isPublic={provider.isPublic}
                canPublish={canPublish}
                action={setProviderPublishAction}
              />
            </TableCell>
            <TableCell align="center">
              <div className="flex items-center justify-center gap-0.5">
                {canManage ? <ProviderFormDrawer mode="edit" provider={provider} /> : null}
                <LinkEditorDrawer
                  label="الفروع"
                  title={`فروع ${provider.nameAr}`}
                  description="الفروع التي يعمل بها مقدّم الخدمة"
                  entityId={provider.id}
                  disabled={!canManage}
                  load={listProviderBranchStateAction}
                  save={(branchIds) => setProviderBranchesAction({ providerId: provider.id, branchIds })}
                  emptyWarning="لن يظهر مقدّم الخدمة في أي فرع، فلا يمكن حجزه."
                />
                <LinkEditorDrawer
                  label="الخدمات"
                  title={`خدمات ${provider.nameAr}`}
                  description="الخدمات التي يقدّمها"
                  entityId={provider.id}
                  disabled={!canManage}
                  load={listProviderServiceStateAction}
                  save={(serviceIds) => setProviderServicesAction({ providerId: provider.id, serviceIds })}
                  emptyWarning="لن يظهر مقدّم الخدمة لأي خدمة، فلا يمكن حجزه."
                />
              </div>
            </TableCell>
          </TableRow>
        )}
      />
    </>
  );
}

/**
 * نموذج مقدّم الخدمة.
 * ⚠️ الهاتف والبريد داخليان: محجوبان عن `anon` على مستوى الأعمدة في قاعدة
 *    البيانات، ولا يُسجَّلان في التدقيق.
 */
function ProviderFormDrawer({
  mode,
  provider,
}: {
  mode: 'create' | 'edit';
  provider?: ProviderRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState(provider?.status ?? 'active');

  const isEdit = mode === 'edit';
  const formId = `provider-form-${provider?.id ?? 'new'}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    const payload = {
      code: String(fd.get('code') ?? ''),
      nameAr: String(fd.get('nameAr') ?? ''),
      specialty: String(fd.get('specialty') ?? ''),
      phone: String(fd.get('phone') ?? ''),
      email: String(fd.get('email') ?? ''),
    };

    startTransition(async () => {
      const result =
        isEdit && provider
          ? await updateProviderAction({ ...payload, id: provider.id, status })
          : await createProviderAction({ ...payload, branchId: null });

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success(isEdit ? 'تم حفظ التعديل' : 'تم إنشاء مقدّم الخدمة — بلا حساب دخول وغير منشور');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" title="تعديل">
            <Pencil className="size-3.5" aria-hidden />
            تعديل
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            مقدّم خدمة جديد
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent
        title={isEdit ? `تعديل ${provider?.nameAr}` : 'إضافة مقدّم خدمة'}
        description={
          isEdit
            ? 'الحالة «غير نشط» تمنع الحجز وتُخفيه من الموقع العام'
            : 'يُنشأ بلا حساب دخول وغير منشور على الموقع العام'
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

          <Field label="الكود" required htmlFor={`${formId}-code`} error={fieldErrors.code?.[0]} hint="مثال: DR-008">
            <Input
              id={`${formId}-code`}
              name="code"
              defaultValue={provider?.code ?? ''}
              dir="ltr"
              className="text-start"
              required
              disabled={pending}
            />
          </Field>

          <Field label="الاسم" required htmlFor={`${formId}-nameAr`} error={fieldErrors.nameAr?.[0]}>
            <Input id={`${formId}-nameAr`} name="nameAr" defaultValue={provider?.nameAr ?? ''} required disabled={pending} />
          </Field>

          <Field label="التخصص" htmlFor={`${formId}-specialty`} error={fieldErrors.specialty?.[0]}>
            <Input id={`${formId}-specialty`} name="specialty" defaultValue={provider?.specialty ?? ''} disabled={pending} />
          </Field>

          <Field
            label="الهاتف"
            htmlFor={`${formId}-phone`}
            error={fieldErrors.phone?.[0]}
            hint="للاستخدام الداخلي — محجوب عن الموقع العام على مستوى قاعدة البيانات"
          >
            <Input
              id={`${formId}-phone`}
              name="phone"
              defaultValue={provider?.phone ?? ''}
              dir="ltr"
              className="text-start"
              disabled={pending}
            />
          </Field>

          <Field
            label="البريد الإلكتروني"
            htmlFor={`${formId}-email`}
            error={fieldErrors.email?.[0]}
            hint="للاستخدام الداخلي — محجوب عن الموقع العام"
          >
            <Input
              id={`${formId}-email`}
              name="email"
              type="email"
              defaultValue={provider?.email ?? ''}
              dir="ltr"
              className="text-start"
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

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Pencil, Plus } from 'lucide-react';
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
  Field,
  Input,
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
import type { RoleRow } from '../repository';
import { createRoleAction, getRolePermissionsAction, updateRoleAction } from '../actions';

export interface PermissionOption {
  key: string;
  nameAr: string;
  module: string;
  sensitive: boolean;
}

/**
 * إدارة الأدوار.
 *
 * ⚠️ نظام الصلاحيات **لا يُعاد تصميمه**. الأدوار النظامية (المشتركة بين كل
 *    المنشآت) تبقى كما هي وغير قابلة للتعديل — سياسات RLS تفرض ذلك، لا الواجهة.
 *    ما يُتاح هنا هو إنشاء أدوار خاصة بالمنشأة من نفس كتالوج الصلاحيات القائم.
 */
export function RolesView({
  roles,
  permissions,
  grantablePermissions,
  canManage,
}: {
  roles: readonly RoleRow[];
  permissions: readonly PermissionOption[];
  /** ما يملكه المُدير فعلًا — وهو سقف ما يمكنه منحه. */
  grantablePermissions: readonly string[];
  canManage: boolean;
}) {
  const systemRoles = roles.filter((r) => r.organizationId === null);
  const customRoles = roles.filter((r) => r.organizationId !== null);

  return (
    <div className="space-y-6">
      <Alert variant="info" title="لا تمنح ما لا تملك">
        لا يمكنك إضافة صلاحية لا تملكها أنت إلى أي دور. القاعدة مفروضة بمحفّز في قاعدة البيانات،
        فلا تُتجاوَز بنداء مباشر على الـAPI.
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>أدوار المنشأة</CardTitle>
              <CardDescription>أدوار خاصة بمنشأتك، قابلة للإنشاء والتعديل.</CardDescription>
            </div>
            {canManage ? (
              <RoleFormDrawer
                mode="create"
                permissions={permissions}
                grantablePermissions={grantablePermissions}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {customRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد أدوار خاصة بالمنشأة. الأدوار النظامية أدناه تكفي لمعظم الحالات.
            </p>
          ) : (
            <RoleTable
              roles={customRoles}
              renderActions={(role) => (
                <RoleFormDrawer
                  mode="edit"
                  role={role}
                  permissions={permissions}
                  grantablePermissions={grantablePermissions}
                  disabled={!canManage}
                />
              )}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
            الأدوار النظامية
          </CardTitle>
          <CardDescription>
            مشتركة بين كل المنشآت وغير قابلة للتعديل من التطبيق. قائمتها الحالية بذرة أولية لم
            تُعتمد نهائيًا (P-16) — أي تغيير فيها قرار عمل لا قرار برمجي.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoleTable roles={systemRoles} />
        </CardContent>
      </Card>
    </div>
  );
}

function RoleTable({
  roles,
  renderActions,
}: {
  roles: readonly RoleRow[];
  renderActions?: (role: RoleRow) => React.ReactNode;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الدور</TableHead>
            <TableHead className="w-48">المعرّف</TableHead>
            <TableHead align="center" className="w-28">
              الصلاحيات
            </TableHead>
            <TableHead align="center" className="w-24">
              النوع
            </TableHead>
            {renderActions ? (
              <TableHead align="center" className="w-28">
                إجراءات
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell className="font-medium">
                {role.nameAr}
                {role.description ? (
                  <p className="text-xs text-muted-foreground">{role.description}</p>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs" dir="ltr">
                {role.key}
              </TableCell>
              <TableCell align="center" numeric>
                {role.permissionCount}
              </TableCell>
              <TableCell align="center">
                <Badge variant={role.isSystem ? 'primary' : 'neutral'}>
                  {role.isSystem ? 'نظامي' : role.organizationId ? 'منشأة' : 'عام'}
                </Badge>
              </TableCell>
              {renderActions ? <TableCell align="center">{renderActions(role)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * نموذج الدور — إنشاء وتعديل.
 * ⚠️ المعرّف (`key`) غير قابل للتعديل: مفتاح طبيعي قد تشير إليه تكاملات لاحقة.
 */
function RoleFormDrawer({
  mode,
  role,
  permissions,
  grantablePermissions,
  disabled,
}: {
  mode: 'create' | 'edit';
  role?: RoleRow;
  permissions: readonly PermissionOption[];
  grantablePermissions: readonly string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);

  const isEdit = mode === 'edit';
  const formId = `role-form-${role?.id ?? 'new'}`;

  /*
    صلاحيات الدور تُحمَّل عند الفتح لا مع الصفحة: تحميلها لكل صف مسبقًا يعني
    استعلامًا لكل دور. وبلا تحميلها يبدأ التعديل من قائمة فارغة فيمحو الصلاحيات
    القائمة عند أول حفظ.
  */
  useEffect(() => {
    if (!open || !isEdit || !role) return;
    setLoading(true);
    setFormError(null);
    getRolePermissionsAction({ id: role.id })
      .then((result) => {
        if (!result.success) {
          setFormError(result.error.message);
          return;
        }
        setSelected([...result.data]);
      })
      .finally(() => setLoading(false));
  }, [open, isEdit, role]);

  const grantable = new Set(grantablePermissions);
  const byModule = new Map<string, PermissionOption[]>();
  for (const permission of permissions) {
    const list = byModule.get(permission.module) ?? [];
    list.push(permission);
    byModule.set(permission.module, list);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result =
        isEdit && role
          ? await updateRoleAction({
              id: role.id,
              nameAr: String(fd.get('nameAr') ?? ''),
              description: String(fd.get('description') ?? ''),
              permissionKeys: selected,
            })
          : await createRoleAction({
              key: String(fd.get('key') ?? ''),
              nameAr: String(fd.get('nameAr') ?? ''),
              description: String(fd.get('description') ?? ''),
              permissionKeys: selected,
            });

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success(isEdit ? 'تم حفظ الدور' : 'تم إنشاء الدور');
      setOpen(false);
      if (!isEdit) setSelected([]);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {isEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={disabled}
            title="تعديل الدور"
          >
            <Pencil className="size-3.5" aria-hidden />
            تعديل
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            دور جديد
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent
        title={isEdit ? `تعديل ${role?.nameAr}` : 'إنشاء دور للمنشأة'}
        description="اختر من كتالوج الصلاحيات القائم — لا صلاحيات جديدة تُختَرع هنا"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            {/* الحفظ معطّل أثناء تحميل الصلاحيات: الحفظ قبل وصولها يُرسل قائمة
                فارغة فيمحو صلاحيات الدور كلها. */}
            <Button type="submit" form={formId} loading={pending} disabled={loading}>
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

          <Field
            label="المعرّف"
            required={!isEdit}
            htmlFor={`${formId}-key`}
            error={fieldErrors.key?.[0]}
            hint={
              isEdit
                ? 'غير قابل للتعديل — مفتاح ثابت قد تشير إليه تكاملات لاحقة'
                : 'حروف لاتينية صغيرة وشرطة سفلية. مثال: shift_supervisor'
            }
          >
            <Input
              id={`${formId}-key`}
              name="key"
              defaultValue={role?.key ?? ''}
              dir="ltr"
              className="text-start"
              required={!isEdit}
              disabled={pending || isEdit}
              readOnly={isEdit}
            />
          </Field>

          <Field label="الاسم بالعربية" required htmlFor={`${formId}-nameAr`} error={fieldErrors.nameAr?.[0]}>
            <Input
              id={`${formId}-nameAr`}
              name="nameAr"
              defaultValue={role?.nameAr ?? ''}
              required
              disabled={pending}
            />
          </Field>

          <Field label="الوصف" htmlFor={`${formId}-description`}>
            <Textarea
              id={`${formId}-description`}
              name="description"
              rows={2}
              defaultValue={role?.description ?? ''}
              disabled={pending}
            />
          </Field>

          <Field
            label={`الصلاحيات (${loading ? '…' : selected.length})`}
            error={fieldErrors.permissionKeys?.[0]}
            hint="الصلاحيات التي لا تملكها معطّلة — لا يمكن منح ما لا تملك"
          >
            <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border p-3">
              {[...byModule].map(([moduleKey, items]) => (
                <div key={moduleKey}>
                  <p className="text-xs font-medium text-muted-foreground" dir="ltr">
                    {moduleKey}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {items.map((permission) => {
                      const allowed = grantable.has(permission.key);
                      return (
                        <label
                          key={permission.key}
                          className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                            allowed ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-40'
                          }`}
                          title={allowed ? undefined : 'لا تملك هذه الصلاحية'}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--color-primary)]"
                            checked={selected.includes(permission.key)}
                            onChange={() =>
                              setSelected((prev) =>
                                prev.includes(permission.key)
                                  ? prev.filter((k) => k !== permission.key)
                                  : [...prev, permission.key],
                              )
                            }
                            disabled={pending || !allowed}
                          />
                          <span>{permission.nameAr}</span>
                          {permission.sensitive ? (
                            <Badge variant="warning" className="text-[10px]">
                              حساسة
                            </Badge>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Field>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

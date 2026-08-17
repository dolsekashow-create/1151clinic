'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Save, ShieldCheck } from 'lucide-react';
import {
  Alert,
  Badge,
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
  toast,
} from '@erp/ui';
import type { RoleRow, UserRow } from '../repository';
import { setUserAssignmentAction, setUserStatusAction, updateUserAction } from '../actions';
import { StatusBadge, type BranchOption } from './users-view';

export function UserDetailView({
  user,
  roles,
  branches,
  permissions,
  canUpdate,
  canManageRoles,
  hasOrgScope,
  isSelf,
}: {
  user: UserRow;
  roles: readonly RoleRow[];
  branches: readonly BranchOption[];
  permissions: readonly string[];
  canUpdate: boolean;
  canManageRoles: boolean;
  hasOrgScope: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <ProfileCard user={user} canUpdate={canUpdate} />
        <AssignmentCard
          user={user}
          roles={roles}
          branches={branches}
          canManageRoles={canManageRoles}
          hasOrgScope={hasOrgScope}
          isSelf={isSelf}
        />
      </div>

      <div className="space-y-6">
        <StatusCard user={user} canUpdate={canUpdate} isSelf={isSelf} />
        <PermissionsCard permissions={permissions} />
      </div>
    </div>
  );
}

/* ------------------------------ بيانات الملف ------------------------------ */

function ProfileCard({ user, canUpdate }: { user: UserRow; canUpdate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateUserAction({
        id: user.id,
        fullNameAr: String(fd.get('fullNameAr') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        jobTitle: String(fd.get('jobTitle') ?? ''),
        employeeCode: String(fd.get('employeeCode') ?? ''),
      });
      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success('تم تحديث البيانات');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>بيانات المستخدم</CardTitle>
        <CardDescription>
          البريد الإلكتروني معرّف الدخول ولا يُعدَّل من هنا — تغييره عملية مصادقة مستقلة.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          <Field label="البريد الإلكتروني">
            <Input value={user.email ?? '—'} dir="ltr" className="text-start" disabled readOnly />
          </Field>

          <Field label="الاسم الكامل" required htmlFor="fullNameAr" error={fieldErrors.fullNameAr?.[0]}>
            <Input
              id="fullNameAr"
              name="fullNameAr"
              defaultValue={user.fullNameAr}
              required
              disabled={pending || !canUpdate}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="رقم الهاتف" htmlFor="phone" error={fieldErrors.phone?.[0]}>
              <Input
                id="phone"
                name="phone"
                defaultValue={user.phone ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending || !canUpdate}
              />
            </Field>
            <Field label="الكود الوظيفي" htmlFor="employeeCode" error={fieldErrors.employeeCode?.[0]}>
              <Input
                id="employeeCode"
                name="employeeCode"
                defaultValue={user.employeeCode ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending || !canUpdate}
              />
            </Field>
          </div>

          <Field label="المسمّى الوظيفي" htmlFor="jobTitle" error={fieldErrors.jobTitle?.[0]}>
            <Input
              id="jobTitle"
              name="jobTitle"
              defaultValue={user.jobTitle ?? ''}
              disabled={pending || !canUpdate}
            />
          </Field>

          {canUpdate ? (
            <Button type="submit" loading={pending}>
              <Save aria-hidden />
              حفظ التغييرات
            </Button>
          ) : (
            <Alert variant="info" title="عرض فقط">
              لا تملك صلاحية تعديل هذا المستخدم.
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/* --------------------------- الدور والفروع ------------------------------- */

function AssignmentCard({
  user,
  roles,
  branches,
  canManageRoles,
  hasOrgScope,
  isSelf,
}: {
  user: UserRow;
  roles: readonly RoleRow[];
  branches: readonly BranchOption[];
  canManageRoles: boolean;
  hasOrgScope: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [scope, setScope] = useState<'organization' | 'branch'>(user.scope ?? 'branch');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>([...user.branchIds]);

  const locked = !canManageRoles || isSelf;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await setUserAssignmentAction({
        id: user.id,
        roleId,
        scope,
        branchIds: scope === 'organization' ? [] : selected,
      });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم تحديث الدور والفروع');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>الدور والنطاق والفروع</CardTitle>
        <CardDescription>
          يُستبدل الدور والفروع معًا في عملية واحدة — لا تنشأ لحظة يكون فيها المستخدم بلا دور.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isSelf ? (
          <Alert variant="warning" title="لا تعديل على نفسك">
            لا يمكن لأي مستخدم تغيير دوره أو فروعه بنفسه، مهما كانت صلاحياته. هذا هو ما يمنع
            التصعيد الذاتي، وهو مفروض في قاعدة البيانات.
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError ? (
              <Alert variant="danger" title="تعذّر التغيير">
                {formError}
              </Alert>
            ) : null}

            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">الدور الحالي: </span>
              <strong>{user.roleNames.length > 0 ? user.roleNames.join('، ') : 'بلا دور'}</strong>
              {user.scope ? (
                <Badge className="ms-2" variant={user.scope === 'organization' ? 'primary' : 'neutral'}>
                  {user.scope === 'organization' ? 'نطاق المنشأة' : 'نطاق فرع'}
                </Badge>
              ) : null}
            </div>

            <Field label="الدور الجديد" required>
              <Select value={roleId} onValueChange={setRoleId} disabled={pending || locked}>
                <SelectTrigger aria-label="الدور الجديد">
                  <SelectValue placeholder="اختر دورًا" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="النطاق" required>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as 'organization' | 'branch')}
                disabled={pending || locked}
              >
                <SelectTrigger aria-label="النطاق">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">فروع محددة</SelectItem>
                  {hasOrgScope ? <SelectItem value="organization">المنشأة كلها</SelectItem> : null}
                </SelectContent>
              </Select>
            </Field>

            {scope === 'branch' ? (
              <Field label="الفروع" required>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={selected.includes(branch.id)}
                        onChange={() =>
                          setSelected((prev) =>
                            prev.includes(branch.id)
                              ? prev.filter((b) => b !== branch.id)
                              : [...prev, branch.id],
                          )
                        }
                        disabled={pending || locked}
                      />
                      {branch.nameAr}
                    </label>
                  ))}
                </div>
              </Field>
            ) : null}

            {locked ? (
              <Alert variant="info" title="عرض فقط">
                تغيير الدور والفروع يتطلب صلاحيتَي إدارة الأدوار وإسناد الفروع.
              </Alert>
            ) : (
              <Button type="submit" loading={pending}>
                <ShieldCheck aria-hidden />
                تطبيق الدور والفروع
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- الحالة ---------------------------------- */

function StatusCard({
  user,
  canUpdate,
  isSelf,
}: {
  user: UserRow;
  canUpdate: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const suspended = user.status === 'suspended';

  function toggle() {
    startTransition(async () => {
      const result = await setUserStatusAction({
        id: user.id,
        status: suspended ? 'active' : 'suspended',
      });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(suspended ? 'تمت إعادة التفعيل' : 'تم إيقاف الحساب');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>حالة الحساب</CardTitle>
        <CardDescription>الإيقاف يمنع الدخول ويُلغي كل الصلاحيات فورًا.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">الحالة الحالية</span>
          <StatusBadge status={user.status} />
        </div>

        <Separator />

        {isSelf ? (
          <Alert variant="info" title="حسابك">
            لا يمكنك إيقاف حسابك بنفسك.
          </Alert>
        ) : canUpdate ? (
          <>
            <Button
              variant={suspended ? 'primary' : 'destructive'}
              block
              loading={pending}
              onClick={toggle}
            >
              {suspended ? <Check aria-hidden /> : <Ban aria-hidden />}
              {suspended ? 'إعادة التفعيل' : 'إيقاف الحساب'}
            </Button>
            <p className="text-xs text-muted-foreground">
              الإيقاف يعمل على طبقتين: إلغاء الصلاحيات في قاعدة البيانات، ومنع تجديد جلسة الدخول
              في خادم المصادقة. البيانات والسجلات لا تُحذف.
            </p>
          </>
        ) : (
          <Alert variant="info" title="عرض فقط">
            لا تملك صلاحية تغيير حالة هذا المستخدم.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- الصلاحيات -------------------------------- */

function PermissionsCard({ permissions }: { permissions: readonly string[] }) {
  const byModule = new Map<string, string[]>();
  for (const key of permissions) {
    const parts = key.split('.');
    const moduleKey = parts[0] ?? 'أخرى';
    const list = byModule.get(moduleKey) ?? [];
    list.push(parts.slice(1).join('.'));
    byModule.set(moduleKey, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>الصلاحيات الفعلية</CardTitle>
        <CardDescription>
          {permissions.length} صلاحية — مشتقّة من الدور، لا تُمنح فرديًا.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا صلاحيات — المستخدم بلا دور فعّال.</p>
        ) : (
          <div className="space-y-3">
            {[...byModule].map(([moduleKey, actions]) => (
              <div key={moduleKey}>
                <p className="text-xs font-medium text-muted-foreground" dir="ltr">
                  {moduleKey}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {actions.map((action) => (
                    <Badge key={action} variant="neutral" className="font-mono text-[10px]" dir="ltr">
                      {action}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

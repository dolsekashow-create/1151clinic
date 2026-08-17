'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ShieldAlert, Stethoscope } from 'lucide-react';
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
import type { RoleRow, UserRow } from '../repository';
import { createProviderAccountAction, createUserAction } from '../actions';

export interface BranchOption {
  id: string;
  nameAr: string;
}

export interface ProviderOption {
  id: string;
  nameAr: string;
  specialty: string | null;
}

const COLUMNS: readonly AdminColumn[] = [
  { key: 'name', label: 'الاسم' },
  { key: 'email', label: 'البريد الإلكتروني', width: 'w-56' },
  { key: 'role', label: 'الدور', width: 'w-40' },
  { key: 'scope', label: 'النطاق', align: 'center', width: 'w-28' },
  { key: 'branches', label: 'الفروع', align: 'center', width: 'w-24' },
  { key: 'status', label: 'الحالة', align: 'center', width: 'w-28' },
];

export function UsersView({
  result,
  error,
  roles,
  branches,
  providers,
  canCreate,
  hasOrgScope,
}: {
  result: Paginated<UserRow> | null;
  error: ApiErrorShape | null;
  roles: readonly RoleRow[];
  branches: readonly BranchOption[];
  providers: readonly ProviderOption[];
  canCreate: boolean;
  hasOrgScope: boolean;
}) {
  return (
    <>
      <Alert variant="info" title="لا كلمات مرور في لوحة الإدارة">
        عند إنشاء المستخدم تُرسَل إليه رسالة لتعيين كلمة مروره بنفسه. اللوحة لا تُظهر كلمة مرور
        ولا رابط استعادة لأي حساب، ولا يمكن استرجاعها لاحقًا.
      </Alert>

      <AdminResourceTable<UserRow>
        result={result}
        error={error}
        columns={COLUMNS}
        searchPlaceholder="بحث بالاسم أو الكود الوظيفي…"
        emptyTitle="لا يوجد مستخدمون"
        emptyDescription="ابدأ بإضافة أول مستخدم."
        actions={
          canCreate ? (
            <div className="flex flex-wrap gap-2">
              <CreateUserDrawer roles={roles} branches={branches} hasOrgScope={hasOrgScope} />
              {providers.length > 0 ? (
                <ProviderAccountDrawer roles={roles} branches={branches} providers={providers} />
              ) : null}
            </div>
          ) : null
        }
        renderRow={(user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">
              <Link href={`/app/users/${user.id}`} className="hover:underline">
                {user.fullNameAr}
              </Link>
              {user.providerId ? (
                <span
                  className="ms-2 inline-flex items-center align-middle text-primary"
                  title="مرتبط بمقدّم خدمة"
                >
                  <Stethoscope className="size-3.5" aria-label="مرتبط بمقدّم خدمة" />
                </span>
              ) : null}
              {user.jobTitle ? (
                <p className="text-xs text-muted-foreground">{user.jobTitle}</p>
              ) : null}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground" dir="ltr">
              {user.email ?? '—'}
            </TableCell>
            <TableCell>{user.roleNames.length > 0 ? user.roleNames.join('، ') : '—'}</TableCell>
            <TableCell align="center">
              {user.scope ? (
                <Badge variant={user.scope === 'organization' ? 'primary' : 'neutral'}>
                  {user.scope === 'organization' ? 'المنشأة' : 'فرع'}
                </Badge>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell align="center" numeric>
              {user.scope === 'organization' ? 'الكل' : user.branchIds.length}
            </TableCell>
            <TableCell align="center">
              <StatusBadge status={user.status} />
            </TableCell>
          </TableRow>
        )}
      />
    </>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="success">نشط</Badge>;
  if (status === 'suspended') return <Badge variant="danger">موقوف</Badge>;
  return <Badge variant="neutral">غير نشط</Badge>;
}

/* ---------------------------- إنشاء مستخدم ------------------------------- */

/**
 * ⚠️ النموذج لا يحتوي حقل كلمة مرور ولن يحتويه. كلمة المرور تُولَّد عشوائيًا في
 *    الخادم ولا تُعاد، والمستخدم يضبطها بنفسه عبر رسالة التعيين.
 * ⚠️ قائمة الأدوار والفروع محدودة أصلًا بما يراه المُدير (RLS)، لكن الحكم
 *    النهائي على ما يجوز منحه في قاعدة البيانات لا في هذه القائمة.
 */
function CreateUserDrawer({
  roles,
  branches,
  hasOrgScope,
}: {
  roles: readonly RoleRow[];
  branches: readonly BranchOption[];
  hasOrgScope: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [scope, setScope] = useState<'organization' | 'branch'>('branch');
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);

  function toggleBranch(id: string) {
    setSelectedBranches((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createUserAction({
        fullNameAr: String(fd.get('fullNameAr') ?? ''),
        email: String(fd.get('email') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        jobTitle: String(fd.get('jobTitle') ?? ''),
        employeeCode: String(fd.get('employeeCode') ?? ''),
        roleId,
        scope,
        branchIds: scope === 'organization' ? [] : selectedBranches,
      });

      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }

      toast.success(
        result.data.invitationSent
          ? 'تم إنشاء المستخدم وإرسال رسالة تعيين كلمة المرور'
          : 'تم إنشاء المستخدم — تعذّر إرسال البريد، فليستخدم «نسيت كلمة المرور»',
      );
      setOpen(false);
      setSelectedBranches([]);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button>
          <Plus aria-hidden />
          مستخدم جديد
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="إضافة مستخدم"
        description="يُنشأ نشطًا، ويضبط كلمة مروره بنفسه عبر رسالة التعيين"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form="user-create-form" loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <form id="user-create-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الإنشاء">
              {formError}
            </Alert>
          ) : null}

          <Field label="الاسم الكامل" required htmlFor="fullNameAr" error={fieldErrors.fullNameAr?.[0]}>
            <Input id="fullNameAr" name="fullNameAr" required disabled={pending} />
          </Field>

          <Field
            label="البريد الإلكتروني"
            required
            htmlFor="email"
            error={fieldErrors.email?.[0]}
            hint="معرّف الدخول — تُرسل إليه رسالة تعيين كلمة المرور"
          >
            <Input id="email" name="email" type="email" dir="ltr" className="text-start" required disabled={pending} />
          </Field>

          <Field label="رقم الهاتف" htmlFor="phone" error={fieldErrors.phone?.[0]}>
            <Input id="phone" name="phone" dir="ltr" className="text-start" disabled={pending} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المسمّى الوظيفي" htmlFor="jobTitle" error={fieldErrors.jobTitle?.[0]}>
              <Input id="jobTitle" name="jobTitle" disabled={pending} />
            </Field>
            <Field label="الكود الوظيفي" htmlFor="employeeCode" error={fieldErrors.employeeCode?.[0]}>
              <Input id="employeeCode" name="employeeCode" dir="ltr" className="text-start" disabled={pending} />
            </Field>
          </div>

          <Field label="الدور" required error={fieldErrors.roleId?.[0]}>
            <Select value={roleId} onValueChange={setRoleId} disabled={pending}>
              <SelectTrigger aria-label="الدور">
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

          <Field
            label="نطاق الصلاحيات"
            required
            hint={
              hasOrgScope
                ? 'نطاق المنشأة يرى كل الفروع. نطاق الفرع يرى الفروع المحددة فقط.'
                : 'نطاق المنشأة غير متاح لك — لا يُمنح إلا من صاحب نطاق منشأة.'
            }
          >
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as 'organization' | 'branch')}
              disabled={pending}
            >
              <SelectTrigger aria-label="نطاق الصلاحيات">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="branch">فروع محددة</SelectItem>
                {hasOrgScope ? <SelectItem value="organization">المنشأة كلها</SelectItem> : null}
              </SelectContent>
            </Select>
          </Field>

          {scope === 'branch' ? (
            <Field
              label="الفروع المسموح بها"
              required
              error={fieldErrors.branchIds?.[0]}
              hint="لا تظهر هنا إلا الفروع التي تملك وصولًا إليها"
            >
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {branches.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">لا توجد فروع متاحة</p>
                ) : (
                  branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={selectedBranches.includes(branch.id)}
                        onChange={() => toggleBranch(branch.id)}
                        disabled={pending}
                      />
                      {branch.nameAr}
                    </label>
                  ))
                )}
              </div>
            </Field>
          ) : null}

          <Alert variant="warning" title="لا تمنح ما لا تملك">
            لا يمكنك إسناد دور يحتوي صلاحيات لا تملكها أنت، ولا إسناد فرع خارج نطاقك. القاعدة
            مفروضة في قاعدة البيانات نفسها، لا في هذه الشاشة.
          </Alert>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/* ---------------------- حساب دخول لمقدّم خدمة ---------------------------- */

/**
 * إنشاء حساب دخول لطبيب قائم — **باختيار المدير فقط** (RQ-02).
 * الأطباء موجودون في `/app/providers` ككيان تشغيلي مستقل بلا حساب افتراضيًا؛
 * هذا النموذج هو الطريق الوحيد لمنح أحدهم حساب دخول.
 */
function ProviderAccountDrawer({
  roles,
  branches,
  providers,
}: {
  roles: readonly RoleRow[];
  branches: readonly BranchOption[];
  providers: readonly ProviderOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const fd = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createProviderAccountAction({
        providerId,
        email: String(fd.get('email') ?? ''),
        roleId,
        branchIds: selectedBranches,
      });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم إنشاء حساب الدخول وربطه بمقدّم الخدمة');
      setOpen(false);
      setSelectedBranches([]);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <Stethoscope aria-hidden />
          حساب لطبيب
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="إنشاء حساب دخول لمقدّم خدمة"
        description="الأطباء لا يملكون حسابات دخول افتراضيًا"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form="provider-account-form" loading={pending}>
              إنشاء الحساب
            </Button>
          </>
        }
      >
        <form id="provider-account-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الإنشاء">
              {formError}
            </Alert>
          ) : null}

          <Alert variant="info" title="لا حساب إلا بقرارك">
            كل حساب دخول إضافي هو سطح هجوم إضافي. لا تُنشئ حسابًا لطبيب لا يستخدم النظام فعلًا.
          </Alert>

          <Field label="مقدّم الخدمة" required>
            <Select value={providerId} onValueChange={setProviderId} disabled={pending}>
              <SelectTrigger aria-label="مقدّم الخدمة">
                <SelectValue placeholder="اختر مقدّم خدمة" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.nameAr}
                    {provider.specialty ? ` — ${provider.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="البريد الإلكتروني" required htmlFor="provider-email">
            <Input
              id="provider-email"
              name="email"
              type="email"
              dir="ltr"
              className="text-start"
              required
              disabled={pending}
            />
          </Field>

          <Field label="الدور" required>
            <Select value={roleId} onValueChange={setRoleId} disabled={pending}>
              <SelectTrigger aria-label="الدور">
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
                    checked={selectedBranches.includes(branch.id)}
                    onChange={() =>
                      setSelectedBranches((prev) =>
                        prev.includes(branch.id)
                          ? prev.filter((b) => b !== branch.id)
                          : [...prev, branch.id],
                      )
                    }
                    disabled={pending}
                  />
                  {branch.nameAr}
                </label>
              ))}
            </div>
          </Field>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/** يُستخدم في صفحة التفاصيل — مُصدَّر هنا لتجميع أيقونات الوحدة. */
export const EscalationIcon = ShieldAlert;

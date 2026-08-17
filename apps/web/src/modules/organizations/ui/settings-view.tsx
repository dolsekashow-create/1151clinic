'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Globe, Save } from 'lucide-react';
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
  Separator,
  Textarea,
  toast,
} from '@erp/ui';
import type { OrganizationRow } from '../repository';
import { setOrganizationPublishAction, updateOrganizationAction } from '../actions';

/**
 * إعدادات المنشأة.
 *
 * ⚠️ لا يحتوي أي إعداد مالي أو تسعيري — P-14 معلّقة ولا حقل سعر في النظام.
 * ⚠️ الكود غير قابل للتعديل: مفتاح طبيعي تُشتق منه المراجع.
 */
export function SettingsView({
  organization,
  canUpdate,
  canPublish,
}: {
  organization: OrganizationRow;
  canUpdate: boolean;
  canPublish: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <ProfileCard organization={organization} canUpdate={canUpdate} />
      </div>
      <PublishCard organization={organization} canPublish={canPublish} />
    </div>
  );
}

function ProfileCard({
  organization,
  canUpdate,
}: {
  organization: OrganizationRow;
  canUpdate: boolean;
}) {
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
      const result = await updateOrganizationAction({
        nameAr: String(fd.get('nameAr') ?? ''),
        nameEn: String(fd.get('nameEn') ?? ''),
        contactPhone: String(fd.get('contactPhone') ?? ''),
        contactEmail: String(fd.get('contactEmail') ?? ''),
        website: String(fd.get('website') ?? ''),
        aboutAr: String(fd.get('aboutAr') ?? ''),
      });
      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success('تم حفظ بيانات المنشأة');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>بيانات المنشأة</CardTitle>
        <CardDescription>
          تظهر بيانات التواصل والنبذة على الموقع العام عند نشر المنشأة.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          <Field label="كود المنشأة" hint="مفتاح ثابت غير قابل للتعديل">
            <Input value={organization.code} dir="ltr" className="text-start" disabled readOnly />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم بالعربية" required htmlFor="nameAr" error={fieldErrors.nameAr?.[0]}>
              <Input
                id="nameAr"
                name="nameAr"
                defaultValue={organization.nameAr}
                required
                disabled={pending || !canUpdate}
              />
            </Field>
            <Field label="الاسم بالإنجليزية" htmlFor="nameEn" error={fieldErrors.nameEn?.[0]}>
              <Input
                id="nameEn"
                name="nameEn"
                defaultValue={organization.nameEn ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending || !canUpdate}
              />
            </Field>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="هاتف التواصل" htmlFor="contactPhone" error={fieldErrors.contactPhone?.[0]}>
              <Input
                id="contactPhone"
                name="contactPhone"
                defaultValue={organization.contactPhone ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending || !canUpdate}
              />
            </Field>
            <Field label="بريد التواصل" htmlFor="contactEmail" error={fieldErrors.contactEmail?.[0]}>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={organization.contactEmail ?? ''}
                dir="ltr"
                className="text-start"
                disabled={pending || !canUpdate}
              />
            </Field>
          </div>

          <Field label="الموقع الإلكتروني" htmlFor="website" error={fieldErrors.website?.[0]}>
            <Input
              id="website"
              name="website"
              defaultValue={organization.website ?? ''}
              dir="ltr"
              className="text-start"
              placeholder="https://"
              disabled={pending || !canUpdate}
            />
          </Field>

          <Field label="نبذة عن المنشأة" htmlFor="aboutAr" error={fieldErrors.aboutAr?.[0]}>
            <Textarea
              id="aboutAr"
              name="aboutAr"
              rows={4}
              defaultValue={organization.aboutAr ?? ''}
              disabled={pending || !canUpdate}
            />
          </Field>

          {canUpdate ? (
            <Button type="submit" loading={pending}>
              <Save aria-hidden />
              حفظ
            </Button>
          ) : (
            <Alert variant="info" title="عرض فقط">
              تعديل بيانات المنشأة يتطلب صلاحية <code>organizations.organization.update</code>.
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function PublishCard({
  organization,
  canPublish,
}: {
  organization: OrganizationRow;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setOrganizationPublishAction({ isPublic: !organization.isPublic });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(organization.isPublic ? 'تم إخفاء المنشأة' : 'تم نشر المنشأة');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          الموقع العام
        </CardTitle>
        <CardDescription>البوابة العليا لكل ما يظهر للزوار.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">حالة المنشأة</span>
          <Badge variant={organization.isPublic ? 'success' : 'neutral'}>
            {organization.isPublic ? 'منشورة' : 'غير منشورة'}
          </Badge>
        </div>

        <Separator />

        <Alert variant="warning" title="أثر هذا المفتاح واسع">
          إخفاء المنشأة يُخفي <strong>كل</strong> الفروع والخدمات والأطباء من الموقع العام دفعةً
          واحدة، مهما كانت حالة نشر كل منها. ونشرها لا يُظهر شيئًا لم يُنشَر بذاته.
        </Alert>

        {canPublish ? (
          <Button
            block
            loading={pending}
            onClick={toggle}
            variant={organization.isPublic ? 'outline' : 'primary'}
          >
            {organization.isPublic ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {organization.isPublic ? 'إخفاء المنشأة' : 'نشر المنشأة'}
          </Button>
        ) : (
          <Alert variant="info" title="صلاحية ناقصة">
            النشر يتطلب صلاحية <code>organizations.organization.publish</code>.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

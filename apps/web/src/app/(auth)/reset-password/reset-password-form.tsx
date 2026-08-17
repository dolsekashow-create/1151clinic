'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Field, Input } from '@erp/ui';
import { updatePasswordAction } from '@/modules/auth/actions';

export function ResetPasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updatePasswordAction(formData);
      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as { fieldErrors?: Record<string, string[]> } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      setDone(true);
      // نُحدّث لتفريغ جلسة الاستعادة من ذاكرة العميل قبل الانتقال
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="تم تعيين كلمة المرور">
          يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.
        </Alert>
        <Button block onClick={() => router.replace('/login')}>
          <CheckCircle2 aria-hidden />
          الانتقال لتسجيل الدخول
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? (
        <Alert variant="danger" title="تعذّر تعيين كلمة المرور">
          {formError}
        </Alert>
      ) : null}

      <Field
        label="كلمة المرور الجديدة"
        required
        htmlFor="password"
        error={fieldErrors.password?.[0]}
        hint="8 أحرف على الأقل"
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
        />
      </Field>

      <Field label="تأكيد كلمة المرور" required htmlFor="confirmPassword" error={fieldErrors.confirmPassword?.[0]}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
        />
      </Field>

      <Button type="submit" block loading={pending}>
        تعيين كلمة المرور
      </Button>
    </form>
  );
}

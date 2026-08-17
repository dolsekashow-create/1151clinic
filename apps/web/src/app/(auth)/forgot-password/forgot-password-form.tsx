'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input } from '@erp/ui';
import { requestPasswordResetAction } from '@/modules/auth/actions';

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await requestPasswordResetAction(formData);
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Alert variant="success" title="تم الإرسال">
        إذا كان البريد مسجّلًا لدينا فستصلك رسالة بها رابط إعادة التعيين خلال دقائق.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="danger" title="تعذّر إرسال الطلب">
          {error}
        </Alert>
      ) : null}

      <Field label="البريد الإلكتروني" required htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          dir="ltr"
          className="text-start"
          required
          disabled={pending}
        />
      </Field>

      <Button type="submit" block loading={pending}>
        إرسال رابط الاستعادة
      </Button>
    </form>
  );
}

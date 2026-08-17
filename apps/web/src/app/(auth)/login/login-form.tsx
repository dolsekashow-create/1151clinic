'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Alert, Button, Field, Input } from '@erp/ui';
import { loginAction } from '@/modules/auth/actions';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set('next', next);

    startTransition(async () => {
      const result = await loginAction(formData);
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      router.replace(result.data.next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="danger" title="تعذّر تسجيل الدخول">
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

      <Field label="كلمة المرور" required htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>

      <Button type="submit" block loading={pending}>
        <LogIn aria-hidden />
        تسجيل الدخول
      </Button>
    </form>
  );
}

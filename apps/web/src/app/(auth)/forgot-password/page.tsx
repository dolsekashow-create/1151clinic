import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Alert } from '@erp/ui';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'استعادة كلمة المرور' };

/** رسائل أخطاء /auth/callback — نصوص ثابتة لا تعكس مدخلات المستخدم. */
const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid: 'الرابط غير صالح أو انتهت صلاحيته. روابط الاستعادة تُستخدم مرة واحدة فقط.',
  not_configured: 'النظام غير مُهيّأ للاتصال بخدمة المصادقة.',
  unexpected: 'حدث خطأ غير متوقع أثناء التحقق من الرابط.',
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? CALLBACK_ERRORS[error] : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold">استعادة كلمة المرور</h1>
            <p className="text-sm text-muted-foreground">
              أدخل بريدك الإلكتروني وسنرسل رابط إعادة التعيين
            </p>
          </div>
        </div>

        {errorMessage ? (
          <Alert variant="danger" title="تعذّر استخدام الرابط">
            {errorMessage}
          </Alert>
        ) : null}

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <ForgotPasswordForm />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            العودة لتسجيل الدخول
          </Link>
        </p>
      </div>
    </main>
  );
}

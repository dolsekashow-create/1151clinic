import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'استعادة كلمة المرور' };

export default function ForgotPasswordPage() {
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { Alert } from '@erp/ui';
import { publicEnv, isSupabaseConfigured } from '@/config/env';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // ⚠️ نقبل مسارات داخلية فقط: قبول عنوان كامل يفتح ثغرة إعادة توجيه مفتوحة
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : '/dashboard';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold">{publicEnv.NEXT_PUBLIC_APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">سجّل الدخول للمتابعة</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <Alert variant="warning" title="النظام غير مُهيّأ">
            إعدادات Supabase ناقصة، تسجيل الدخول معطّل. أكمل المتغيرات في ملف البيئة.
          </Alert>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <LoginForm next={next} />
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          نسيت كلمة المرور؟{' '}
          <Link href="/forgot-password" className="text-primary hover:underline">
            استعادة كلمة المرور
          </Link>
        </p>
      </div>
    </main>
  );
}

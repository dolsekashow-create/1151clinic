import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Alert, Button } from '@erp/ui';
import { createClient } from '@/infrastructure/supabase/server';
import { isSupabaseConfigured } from '@/config/env';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'تعيين كلمة مرور جديدة' };
export const dynamic = 'force-dynamic';

/**
 * تعيين كلمة مرور جديدة.
 *
 * يُوصل إليها من /auth/callback بعد تبادل رمز البريد بجلسة استعادة.
 * ⚠️ لا تُفتح مباشرةً: بلا جلسة صالحة تعرض رسالة انتهاء الرابط بدل نموذج
 *    لا يعمل — كان هذا سبب كسر المسار سابقًا (الصفحة لم تكن موجودة أصلًا).
 */
export default async function ResetPasswordPage() {
  const hasSession = await checkRecoverySession();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold">تعيين كلمة مرور جديدة</h1>
            <p className="text-sm text-muted-foreground">اختر كلمة مرور قوية لا تستخدمها في مكان آخر</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          {!isSupabaseConfigured ? (
            <Alert variant="warning" title="النظام غير مُهيّأ">
              إعدادات Supabase ناقصة.
            </Alert>
          ) : hasSession ? (
            <ResetPasswordForm />
          ) : (
            <div className="space-y-4">
              <Alert variant="danger" title="الرابط غير صالح أو منتهي">
                روابط الاستعادة تُستخدم مرة واحدة وتنتهي صلاحيتها بعد مدة قصيرة. اطلب رابطًا جديدًا.
              </Alert>
              <Button asChild block variant="outline">
                <Link href="/forgot-password">طلب رابط جديد</Link>
              </Button>
            </div>
          )}
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

/** ⚠️ getUser() لا getSession(): الأولى تتحقق من التوقيع مع خادم المصادقة. */
async function checkRecoverySession(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@erp/types';
import { AppError, errors, fail, ok, toActionResult } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import { publicEnv } from '@/config/env';

/**
 * أفعال المصادقة.
 *
 * ⚠️ كلمات المرور لا تمر بأي كود لنا ولا تُخزَّن ولا تُسجَّل — تُمرَّر مباشرة
 *    إلى Supabase Auth. هذا الملف لا يكتب كلمة المرور في أي سجل أو رسالة خطأ.
 *
 * ⚠️ BUSINESS_DECISION_PENDING: طريقة الدخول النهائية (بريد/هاتف/OTP) و MFA
 *    لم تُعتمد بعد (Q-07). المنفّذ حاليًا هو البريد + كلمة المرور لأنه الأساس
 *    المدعوم في Supabase Auth، وإضافة الباقي لا تتطلب تغييرًا معماريًا.
 */

const loginSchema = z.object({
  email: z.string().trim().email('بريد إلكتروني غير صالح'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  next: z.string().startsWith('/').optional(),
});

export async function loginAction(formData: FormData): Promise<ActionResult<{ next: string }>> {
  try {
    const parsed = loginSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      next: formData.get('next') || undefined,
    });

    if (!parsed.success) {
      throw errors.validation({
        form: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      // ⚠️ رسالة واحدة لكل حالات الفشل: التمييز بين «بريد غير موجود» و«كلمة
      //    مرور خاطئة» يسمح بتعداد الحسابات (user enumeration).
      return fail(
        new AppError({
          code: 'UNAUTHENTICATED',
          userMessage: 'بيانات الدخول غير صحيحة',
          httpStatus: 401,
        }),
      );
    }

    return ok({ next: parsed.data.next ?? '/dashboard' });
  } catch (error) {
    return toActionResult(error);
  }
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

const resetRequestSchema = z.object({ email: z.string().trim().email('بريد إلكتروني غير صالح') });

export async function requestPasswordResetAction(
  formData: FormData,
): Promise<ActionResult<{ sent: true }>> {
  try {
    const parsed = resetRequestSchema.safeParse({ email: formData.get('email') });
    if (!parsed.success) {
      throw errors.validation({ email: parsed.error.issues.map((issue) => issue.message) });
    }

    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/reset-password`,
    });

    // ⚠️ نُعيد نجاحًا دائمًا — حتى لو لم يكن البريد مسجّلًا — لمنع تعداد الحسابات.
    return ok({ sent: true as const });
  } catch (error) {
    return toActionResult(error);
  }
}

'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@erp/types';
import { AppError, errors, fail, ok, toActionResult } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import { enforceRateLimit } from '@/infrastructure/rate-limit';
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

    // الحد يُطبَّق على (العميل + البريد) معًا: يمنع تخمين كلمة مرور حساب واحد
    // من عميل واحد، بلا حجب بقية مستخدمي نفس الشبكة.
    const limit = await enforceRateLimit('login', parsed.data.email);

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

    // نجاح ⇒ نُصفّر العدّاد حتى لا تُعاقب المحاولات المشروعة المتكررة
    await limit.reset();

    return ok({ next: parsed.data.next ?? '/app' });
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

    // يحمي من إغراق صندوق بريد شخص آخر ومن استخدام النقطة كمُعدِّد حسابات
    await enforceRateLimit('passwordReset', parsed.data.email);

    const supabase = await createClient();
    /*
      ⚠️ لا يجوز التوجيه إلى /reset-password مباشرةً: رابط البريد يحمل رمزًا
         يجب تبادله بجلسة أولًا، والتبادل يكتب كوكيز فلا يصلح داخل صفحة.
         لذلك نوجّه إلى /auth/callback الذي يتبادل الرمز ثم يُحوِّل.
         هذا هو سبب كسر المسار سابقًا.
    */
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=%2Freset-password`,
    });

    // ⚠️ نُعيد نجاحًا دائمًا — حتى لو لم يكن البريد مسجّلًا — لمنع تعداد الحسابات.
    return ok({ sent: true as const });
  } catch (error) {
    return toActionResult(error);
  }
}

/* -------------------------------------------------------------------------- */
/*  تعيين كلمة مرور جديدة بعد الاستعادة                                        */
/* -------------------------------------------------------------------------- */

const updatePasswordSchema = z
  .object({
    password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل').max(72, 'كلمة المرور طويلة جدًا'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
  });

/**
 * يعيّن كلمة مرور جديدة للمستخدم الحالي.
 *
 * يتطلب جلسة استعادة صالحة — تُنشأ في /auth/callback من رابط البريد.
 * ⚠️ نستخدم getUser() لا getSession(): الأولى تتحقق من التوقيع مع خادم المصادقة.
 * ⚠️ كلمة المرور تُمرَّر إلى Supabase مباشرةً ولا تُسجَّل في أي مكان.
 */
export async function updatePasswordAction(
  formData: FormData,
): Promise<ActionResult<{ updated: true }>> {
  try {
    const parsed = updatePasswordSchema.safeParse({
      password: formData.get('password'),
      confirmPassword: formData.get('confirmPassword'),
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      throw errors.validation(fieldErrors);
    }

    await enforceRateLimit('passwordUpdate');

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return fail(
        new AppError({
          code: 'UNAUTHENTICATED',
          userMessage: 'انتهت صلاحية رابط الاستعادة. اطلب رابطًا جديدًا.',
          httpStatus: 401,
        }),
      );
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

    if (error) {
      return fail(
        errors.conflict('تعذّر تعيين كلمة المرور. تأكد أنها مختلفة عن السابقة وحاول مرة أخرى.'),
      );
    }

    return ok({ updated: true as const });
  } catch (error) {
    return toActionResult(error);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@erp/core';
import { enforceRateLimit } from '@/infrastructure/rate-limit';
import { listPublicSlots } from '@/modules/public-site/booking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/public/availability — الأوقات المتاحة للزائر.
 *
 * ⚠️ لا مصادقة: نقطة عامة عمدًا. الحماية ثلاث طبقات:
 *    1) حد معدّل مشترك بين نسخ الخادم (لا في الذاكرة).
 *    2) بوابة النشر داخل `app.public_available_slots` — فرع أو خدمة أو مقدّم
 *       غير منشور يُرجع صفر أوقات، لا خطأ يكشف وجوده.
 *    3) لا يقرأ الطلب أي جدول تشغيلي: كل شيء عبر دالة SECURITY DEFINER.
 *
 * ⚠️ لا تُرجع أي بيانات شخصية ولا أسماء عملاء ولا معرّفات داخلية زائدة —
 *    قائمة أوقات فقط.
 */

const querySchema = z.object({
  branch_id: z.string().uuid('معرّف فرع غير صالح'),
  service_id: z.string().uuid('معرّف خدمة غير صالح'),
  provider_id: z.string().uuid('معرّف مقدّم خدمة غير صالح'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'تاريخ غير صالح'),
});

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit('publicAvailability');

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      // ⚠️ رسالة واحدة عامة: تفصيل أي حقل فشل يساعد على استكشاف المعرّفات
      return NextResponse.json(
        { error: 'طلب غير صالح' },
        { status: 422, headers: { 'cache-control': 'no-store' } },
      );
    }

    const slots = await listPublicSlots({
      branchId: parsed.data.branch_id,
      serviceId: parsed.data.service_id,
      providerId: parsed.data.provider_id,
      date: parsed.data.date,
    });

    return NextResponse.json(
      { date: parsed.data.date, slots: slots.map((s) => s.startsAt) },
      {
        // لا تخزين: الأوقات تتغيّر مع كل حجز
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (error) {
    if (AppError.isAppError(error) && error.code === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: error.userMessage },
        { status: 429, headers: { 'cache-control': 'no-store' } },
      );
    }
    console.error('[api/public/availability] خطأ غير متوقع', error);
    return NextResponse.json(
      { error: 'تعذّر جلب الأوقات المتاحة، حاول مرة أخرى' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

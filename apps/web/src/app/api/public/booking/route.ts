import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@erp/core';
import { HONEYPOT_FIELD, enforceRateLimit, isHoneypotTriggered } from '@/infrastructure/rate-limit';
import { createPublicBooking } from '@/modules/public-site/booking';
import { notifyBookingCreated } from '@/modules/public-site/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/public/booking — إنشاء حجز من الموقع العام.
 *
 * ⚠️ لا `INSERT` مباشرًا من دور `anon` إلى أي جدول: العملية كلها داخل
 *    `app.create_public_booking` التي تُعيد فحص النشر والترابط والتوفّر
 *    والتعارض في المحرّك.
 * ⚠️ لا مفتاح خدمة في هذا المسار. الاستثناء الوحيد هو عدّاد الحد من المعدّل،
 *    وهو جدول عدّادات لا يقرأ أي بيانات تشغيلية.
 * ⚠️ الحقول الحسّاسة (المدة، النهاية، الحالة، الرقم المرجعي، المنشأة) غير
 *    موجودة في المخطط أدناه ولا في توقيع دالة قاعدة البيانات — لا سبيل لتزويرها.
 */

const bodySchema = z.object({
  branch_id: z.string().uuid(),
  service_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  /** لحظة مطلقة من قائمة الأوقات المتاحة — يُعاد التحقق منها في المحرّك. */
  slot: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'وقت غير صالح'),
  full_name: z.string().trim().min(3, 'الاسم قصير جدًا').max(200),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\s-]{7,20}$/, 'رقم هاتف غير صالح'),
  email: z.string().trim().email().max(320).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
  /** حقل الفخّ — يتركه الإنسان فارغًا. */
  [HONEYPOT_FIELD]: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
      return json({ error: 'طلب غير صالح' }, 422);
    }

    /*
      ⚠️ الفخّ يُفحص **قبل** الحد من المعدّل وقبل أي عمل: الروبوت لا يستهلك
         عدّاد الزوار الحقيقيين، ولا نُنشئ شيئًا.
      ⚠️ الاستجابة **نجاح وهمي** برقم مرجعي غير موجود: إرجاع خطأ يُعلّم الروبوت
         أن الحقل فخّ فيتجنّبه في المحاولة التالية.
    */
    if (isHoneypotTriggered((raw as Record<string, unknown>)[HONEYPOT_FIELD] as string)) {
      console.warn('[api/public/booking] حقل الفخّ مملوء — رُفض الطلب بصمت');
      return json({ reference_no: 'APT-000000', reused: false }, 201);
    }

    await enforceRateLimit('publicBooking');

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return json({ error: first?.message ?? 'بيانات غير صالحة' }, 422);
    }

    const input = parsed.data;
    const result = await createPublicBooking({
      branchId: input.branch_id,
      serviceId: input.service_id,
      providerId: input.provider_id,
      slot: new Date(input.slot).toISOString(),
      fullName: input.full_name,
      phone: input.phone,
      email: input.email || undefined,
      notes: input.notes || undefined,
      idempotencyKey: input.idempotency_key,
    });

    /*
      ⚠️ الإشعار **لا يُفشل الحجز**: الحجز مثبَّت في قاعدة البيانات قبل هذه
         النقطة، وفشل الإرسال لا يُلغيه. إن لم يوجد مزوّد مهيّأ يُسجَّل التخطّي.
    */
    await notifyBookingCreated(result.referenceNo);

    return json({ reference_no: result.referenceNo, reused: result.reused }, result.reused ? 200 : 201);
  } catch (error) {
    if (AppError.isAppError(error)) {
      if (error.code === 'RATE_LIMITED') return json({ error: error.userMessage }, 429);
      // رسائل CONFLICT مكتوبة للمستخدم النهائي («هذا الموعد لم يعد متاحًا…»)
      if (error.code === 'CONFLICT') return json({ error: error.userMessage }, 409);
      if (error.code === 'PERMISSION_DENIED') return json({ error: error.userMessage }, 403);
    }
    // ⚠️ لا نُسرّب رسالة المحرّك: قد تحوي أسماء جداول أو قيودًا
    console.error('[api/public/booking] خطأ غير متوقع', error);
    return json({ error: 'حدث خطأ أثناء إنشاء الحجز، حاول مرة أخرى' }, 500);
  }
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

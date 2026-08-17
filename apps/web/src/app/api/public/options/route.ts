import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@erp/core';
import { enforceRateLimit } from '@/infrastructure/rate-limit';
import { listBookableProviders, listBookableServices } from '@/modules/public-site/booking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/public/options — خيارات نموذج الحجز.
 *
 * `?branch_id=` ⇒ الخدمات المتاحة في الفرع.
 * `?branch_id=&service_id=` ⇒ مقدّمو الخدمة المتاحون لتلك الخدمة في ذلك الفرع.
 *
 * ⚠️ يقرأ بدور `anon` عبر `createPublicClient()` ⇒ ما لم يُنشَر لا يظهر، بلا
 *    أي شرط إضافي في هذه الطبقة.
 * ⚠️ لا يُرجع سعرًا ولا هاتف طبيب ولا بريده: الأعمدة الحسّاسة محجوبة عن `anon`
 *    على مستوى **أعمدة** قاعدة البيانات، فلا يمكن لهذا المسار كشفها.
 * ⚠️ يشترك مع الأوقات في نفس حد المعدّل: كلاهما قراءة عامة متكررة.
 */

const querySchema = z.object({
  branch_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit('publicAvailability');

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'طلب غير صالح' },
        { status: 422, headers: { 'cache-control': 'no-store' } },
      );
    }

    const { branch_id: branchId, service_id: serviceId } = parsed.data;

    if (serviceId) {
      const providers = await listBookableProviders(branchId, serviceId);
      return NextResponse.json({ providers }, { headers: { 'cache-control': 'no-store' } });
    }

    const services = await listBookableServices(branchId);
    return NextResponse.json({ services }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (AppError.isAppError(error) && error.code === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: error.userMessage },
        { status: 429, headers: { 'cache-control': 'no-store' } },
      );
    }
    console.error('[api/public/options] خطأ غير متوقع', error);
    return NextResponse.json(
      { error: 'تعذّر جلب الخيارات، حاول مرة أخرى' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

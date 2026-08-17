import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/infrastructure/supabase/middleware';

/**
 * الـ middleware مسؤول عن أمرين فقط:
 *   1. تحديث توكن الجلسة في كل طلب (وإلا انتهت صلاحيته أثناء العمل).
 *   2. منع الزائر غير المصادَق من الوصول إلى النظام الداخلي.
 *
 * ⚠️ ليس طبقة تخويل: لا يفحص الصلاحيات ولا نطاق الفروع.
 *    التخويل يتم في الخادم (requirePermission) وفي RLS.
 *    الاعتماد على middleware للتفويض خطأ شائع — يمكن تجاوزه بطلب مباشر لـ PostgREST.
 *
 * ⚠️ منطق الحماية **مقلوب** عن السابق:
 *    كان: كل شيء محمي إلا قائمة بيضاء صغيرة.
 *    صار: كل شيء عام إلا `/app/*`.
 *    السبب: الموقع العام صار الواجهة الافتراضية. والانقلاب مقصود وصريح —
 *    أي مسار إداري جديد **يجب** أن يُنشأ تحت `/app/*` وإلا صار عامًا بلا قصد.
 */

/** بادئة النظام الداخلي — المنطقة الوحيدة التي تتطلب جلسة. */
const PROTECTED_PREFIX = '/app';

function isProtectedPath(pathname: string): boolean {
  return pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
}

export async function middleware(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // مستخدم مصادَق يفتح صفحة الدخول ⇒ إلى النظام الداخلي
  if (userId && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = PROTECTED_PREFIX;
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (isProtectedPath(pathname) && !userId) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * كل المسارات عدا:
     *   _next/static, _next/image, favicon, الملفات الثابتة, و /api/health
     *
     * الموقع العام يمرّ من هنا أيضًا — لا لحمايته بل لتحديث الجلسة، حتى يظهر
     * زر «دخول الموظفين» بحالة صحيحة لمن سبق أن سجّل دخوله.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

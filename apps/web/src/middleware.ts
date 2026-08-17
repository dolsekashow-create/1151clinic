import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/infrastructure/supabase/middleware';

/** مسارات عامة لا تتطلب جلسة. */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/auth'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * الـ middleware مسؤول عن أمرين فقط:
 *   1. تحديث توكن الجلسة في كل طلب (وإلا انتهت صلاحيته أثناء العمل).
 *   2. إعادة توجيه الزائر غير المصادَق بعيدًا عن المسارات المحمية.
 *
 * ⚠️ ليس طبقة تخويل: لا يفحص الصلاحيات ولا نطاق الفروع.
 *    التخويل يتم في الخادم (requirePermission) وفي RLS.
 *    الاعتماد على middleware للتفويض خطأ شائع — يمكن تجاوزه بطلب مباشر لـ PostgREST.
 */
export async function middleware(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // مستخدم مصادَق يفتح صفحة الدخول ⇒ إلى لوحة المعلومات
    if (userId && pathname === '/login') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!userId) {
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
     */
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

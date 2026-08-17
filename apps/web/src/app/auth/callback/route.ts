import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@erp/types';
import { isSupabaseConfigured, publicEnv } from '@/config/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * نقطة عودة Supabase Auth — تبادل الرمز بجلسة.
 *
 * تُستخدم في:
 *   • استعادة كلمة المرور (recovery) → next=/reset-password
 *   • دعوات المستخدمين (invite) لاحقًا — نفس المسار بلا تغيير
 *
 * ⚠️ لماذا Route Handler لا صفحة؟ تبادل الرمز يكتب كوكيز الجلسة، والكتابة في
 *    الكوكيز غير مسموحة داخل Server Component. هذا سبب كسر المسار السابق:
 *    كان البريد يوجّه إلى /reset-password مباشرةً بلا أي خطوة تبادل، فتصل
 *    الصفحة بلا جلسة ولا رمز مُستهلَك.
 *
 * ⚠️ `next` يُقيَّد بمسارات داخلية فقط — قبول عنوان كامل = ثغرة إعادة توجيه مفتوحة.
 */

/** مسارات العودة المسموح بها. قائمة بيضاء لا تحقق نمطي. */
const ALLOWED_NEXT = new Set(['/reset-password', '/login', '/app']);

function safeNext(raw: string | null): string {
  if (!raw) return '/app';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/app';
  // noUncheckedIndexedAccess مُفعَّل ⇒ الفهرسة قد تُرجع undefined
  const path = raw.split('?')[0]?.split('#')[0] ?? '';
  return ALLOWED_NEXT.has(path) ? raw : '/app';
}

function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/forgot-password';
  url.search = `?error=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNext(searchParams.get('next'));

  // خطأ صريح من Supabase (رابط منتهٍ أو مُستهلَك)
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  if (providerError) return errorRedirect(request, 'link_invalid');

  if (!isSupabaseConfigured) return errorRedirect(request, 'not_configured');
  if (!code && !tokenHash) return errorRedirect(request, 'link_invalid');

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = next;
  redirectUrl.search = '';
  const response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL as string,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // ⚠️ نكتب في نفس كائن الاستجابة المُعاد — إنشاء استجابة جديدة بعد
          //    التبادل يُسقط كوكيز الجلسة فيصل المستخدم بلا جلسة.
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return errorRedirect(request, 'link_invalid');
    } else if (tokenHash && type) {
      // مسار التوكن المُجزَّأ (بعض قوالب بريد Supabase تستخدمه)
      const { error } = await supabase.auth.verifyOtp({
        type: type as 'recovery' | 'invite' | 'email',
        token_hash: tokenHash,
      });
      if (error) return errorRedirect(request, 'link_invalid');
    }
  } catch {
    // لا نُمرّر تفاصيل الاستثناء إلى العنوان
    return errorRedirect(request, 'unexpected');
  }

  return response;
}

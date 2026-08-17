import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@erp/types';
import { isSupabaseConfigured, publicEnv } from '@/config/env';

/**
 * تحديث جلسة Supabase في الـ middleware.
 *
 * ⚠️ نقطة حرجة في @supabase/ssr: يجب إعادة نفس كائن الاستجابة الذي كُتبت فيه
 *    الكوكيز. إنشاء استجابة جديدة بعد التحديث يُسقط التوكن المُحدَّث ويُخرج
 *    المستخدم عشوائيًا بعد انتهاء صلاحية التوكن.
 *
 * ⚠️ نستخدم getUser() وليس getSession(): الأولى تتحقق من التوقيع مع خادم
 *    المصادقة، والثانية تقرأ الكوكي كما هي — وهي غير صالحة لاتخاذ قرار أمني.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  userId: string | null;
}> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
    return { response, userId: null };
  }

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL as string,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { response, userId: user?.id ?? null };
  } catch {
    // انقطاع الاتصال بخدمة المصادقة لا يجب أن يُسقط الطلب بخطأ 500؛
    // يُعامل كعدم وجود جلسة، والمسارات المحمية تُعيد التوجيه لتسجيل الدخول.
    return { response, userId: null };
  }
}

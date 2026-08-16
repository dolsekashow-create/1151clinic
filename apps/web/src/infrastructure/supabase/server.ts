import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@erp/types';
import { requireSupabasePublicEnv } from '@/config/env';

/**
 * عميل Supabase لجهة الخادم (Server Components / Server Actions / Route Handlers).
 *
 * يعمل بجلسة المستخدم نفسها ⇒ **تنطبق عليه سياسات RLS كاملة**.
 * هذا هو العميل الافتراضي لكل قراءة وكتابة في النظام.
 *
 * ملاحظة أمنية: لتحديد هوية المستخدم استخدم `getUser()` وليس `getSession()`؛
 * الأولى تتحقق من التوقيع مع خادم المصادقة، والثانية تقرأ الكوكي كما هي.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // الكتابة في الكوكيز غير مسموحة داخل Server Component؛
          // تحديث الجلسة يتم في middleware (Phase 2). التجاهل هنا مقصود.
        }
      },
    },
  });
}

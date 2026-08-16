import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@erp/types';
import { requireSupabasePublicEnv, serverEnv } from '@/config/env';

/**
 * ⛔ عميل الإدارة — يعمل بمفتاح `service_role` و**يتجاوز كل سياسات RLS**.
 *
 * استيراد `server-only` أعلاه يجعل أي محاولة لاستخدام هذا الملف من مكوّن عميل
 * تفشل عند البناء — وهذا هو الحاجز التقني، لا مجرد اتفاق.
 *
 * الاستخدامات المسموحة حصرًا (راجع docs/SECURITY.md §4):
 *   • تهيئة البيانات المرجعية (seeding)
 *   • مهام إدارية موثّقة تُنفَّذ بعد فحص صلاحية صريح في الكود
 *   • Webhooks موقّعة ومهام خلفية
 *
 * ❌ ممنوع استخدامه لتجاوز فحص صلاحية، أو لجلب بيانات لمستخدم عادي.
 */
export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY غير مضبوط. هذا المفتاح مطلوب للعمليات الإدارية فقط ' +
        'ويجب ألا يُضبط في أي بيئة عميل.',
    );
  }

  return createSupabaseClient<Database>(url, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

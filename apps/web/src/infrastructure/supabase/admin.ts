import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@erp/types';
import { requireSupabasePublicEnv, serverEnv } from '@/config/env';

/**
 * ⛔ عميل الإدارة — يعمل بمفتاح Secret (`sb_secret_…`) و**يتجاوز كل سياسات RLS**.
 *
 * استيراد `server-only` أعلاه يجعل أي محاولة لاستخدام هذا الملف من مكوّن عميل
 * تفشل عند البناء — وهذا هو الحاجز التقني، لا مجرد اتفاق.
 *
 * الاستخدامات المسموحة حصرًا (راجع docs/SECURITY.md §4):
 *   • تهيئة البيانات المرجعية (seeding)
 *   • إنشاء مستخدم جديد عبر Auth Admin API بعد فحص صلاحية `identity.users.create`
 *   • Webhooks موقّعة ومهام خلفية
 *
 * ❌ ممنوع استخدامه لتجاوز فحص صلاحية، أو لجلب بيانات لمستخدم عادي.
 *
 * النظام يعمل كاملًا بدون هذا المفتاح؛ غيابه يعطّل العمليات الإدارية فقط.
 */
export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const { SUPABASE_SECRET_KEY } = serverEnv();

  if (!SUPABASE_SECRET_KEY) {
    throw new Error(
      'SUPABASE_SECRET_KEY غير مضبوط. هذا المفتاح مطلوب للعمليات الإدارية فقط، ' +
        'ويجب ألا يُضبط في أي بيئة عميل ولا أن يُرفع إلى Git.',
    );
  }

  return createSupabaseClient<Database>(url, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/** هل العمليات الإدارية متاحة في هذه البيئة؟ */
export function isAdminClientAvailable(): boolean {
  return Boolean(serverEnv().SUPABASE_SECRET_KEY);
}

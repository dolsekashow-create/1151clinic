import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@erp/types';
import { requireSupabasePublicEnv } from '@/config/env';

/**
 * عميل الموقع العام — دور `anon` دائمًا، بلا جلسة.
 *
 * ⚠️ لماذا عميل منفصل عن `server.ts`؟
 *    عميل الخادم يقرأ كوكيز الجلسة. فلو زار موظفٌ مسجّل الموقع العام لرأى
 *    محتوى أكثر من الزائر العادي — فيصبح الموقع العام غير قابل للاختبار
 *    ويُظهر بيانات غير منشورة لمن لا يقصد ذلك.
 *    هذا العميل **يتجاهل الكوكيز**، فما يظهر هنا هو ما يراه العالم بالضبط.
 *
 * ⚠️ يستخدم مفتاح Publishable حصرًا. **ممنوع** استخدام SUPABASE_SECRET_KEY
 *    لقراءة الموقع العام — الحماية من RLS لا من إخفاء المفتاح.
 *
 * ⚠️ استعلامات هذا العميل يجب أن تُحدّد الأعمدة صراحةً. `select('*')` يفشل
 *    لأن `anon` يملك منحًا على مستوى الأعمدة فقط — وهذا حاجز مقصود.
 */
export function createPublicClient() {
  const { url, publishableKey } = requireSupabasePublicEnv();
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-erp-surface': 'public-site' } },
  });
}

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@erp/types';
import { requireSupabasePublicEnv } from '@/config/env';

/**
 * عميل Supabase للمتصفح.
 *
 * يستخدم مفتاح `anon` فقط — كل ما يستطيع قراءته أو كتابته محكوم بسياسات RLS.
 * ⚠️ لا تفترض أن إخفاء زر في الواجهة يمنع الوصول؛ الضامن هو RLS.
 */
export function createClient() {
  const { url, anonKey } = requireSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}

import 'server-only';

import {
  isSupabaseConfigured,
  missingPublicEnv,
  publicEnv,
  publicEnvIssues,
  supabaseProjectRef,
} from '@/config/env';

export type HealthStatus = 'ok' | 'not_configured' | 'invalid_key' | 'unreachable';

export interface SupabaseHealth {
  readonly status: HealthStatus;
  readonly message: string;
  readonly projectRef: string | null;
  readonly latencyMs: number | null;
  readonly missingEnv: readonly string[];
  readonly envIssues: readonly string[];
}

/**
 * فحص اتصال Supabase.
 *
 * يستخدم نقطة `/auth/v1/health` العامة: لا تتطلب جلسة ولا تكشف أي بيانات،
 * وتُثبت أن عنوان المشروع والمفتاح العام صحيحان وأن الخدمة تستجيب.
 *
 * نميّز بين ثلاث حالات فشل مختلفة عمدًا، لأن علاج كل منها مختلف:
 *   not_configured → متغيرات ناقصة
 *   invalid_key    → المشروع موجود لكن المفتاح مرفوض (401/403)
 *   unreachable    → لا استجابة أصلًا
 */
export async function checkSupabaseHealth(timeoutMs = 5000): Promise<SupabaseHealth> {
  const missingEnv = missingPublicEnv();
  const projectRef = supabaseProjectRef();

  if (!isSupabaseConfigured) {
    return {
      status: 'not_configured',
      message: 'إعدادات Supabase غير مكتملة — أكمل المتغيرات في .env.local',
      projectRef,
      latencyMs: null,
      missingEnv,
      envIssues: publicEnvIssues,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '' },
      signal: controller.signal,
      cache: 'no-store',
    });

    const latencyMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'invalid_key',
        message:
          'المشروع موجود لكن المفتاح مرفوض. تحقق من NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
          'في لوحة Supabase ← Project Settings ← API Keys.',
        projectRef,
        latencyMs,
        missingEnv,
        envIssues: publicEnvIssues,
      };
    }

    if (!response.ok) {
      return {
        status: 'unreachable',
        message: `الخدمة ردّت برمز ${response.status}`,
        projectRef,
        latencyMs,
        missingEnv,
        envIssues: publicEnvIssues,
      };
    }

    return {
      status: 'ok',
      message: 'الاتصال بـ Supabase يعمل',
      projectRef,
      latencyMs,
      missingEnv,
      envIssues: publicEnvIssues,
    };
  } catch {
    // لا نُمرّر تفاصيل الاستثناء للواجهة — قد تكشف بنية الشبكة الداخلية
    return {
      status: 'unreachable',
      message: 'تعذّر الوصول إلى Supabase (تحقق من العنوان أو من الاتصال بالشبكة)',
      projectRef,
      latencyMs: null,
      missingEnv,
      envIssues: publicEnvIssues,
    };
  } finally {
    clearTimeout(timer);
  }
}

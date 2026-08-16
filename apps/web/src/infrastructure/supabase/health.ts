import 'server-only';

import { isSupabaseConfigured, missingPublicEnv, publicEnv } from '@/config/env';

export type HealthStatus = 'ok' | 'not_configured' | 'unreachable';

export interface SupabaseHealth {
  readonly status: HealthStatus;
  readonly message: string;
  readonly latencyMs: number | null;
  readonly missingEnv: readonly string[];
}

/**
 * فحص اتصال Supabase.
 *
 * يستخدم نقطة `/auth/v1/health` العامة: لا تتطلب جلسة ولا تكشف أي بيانات،
 * وتُثبت أن عنوان المشروع والمفتاح العام صحيحان وأن الخدمة تستجيب.
 * لا تُستخدم استعلامات جداول هنا — لا توجد جداول بعد في المرحلة 1.
 */
export async function checkSupabaseHealth(timeoutMs = 4000): Promise<SupabaseHealth> {
  const missingEnv = missingPublicEnv();

  if (!isSupabaseConfigured) {
    return {
      status: 'not_configured',
      message: 'إعدادات Supabase غير مكتملة — أكمل المتغيرات في .env.local',
      latencyMs: null,
      missingEnv,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
      signal: controller.signal,
      cache: 'no-store',
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        status: 'unreachable',
        message: `الخدمة ردّت برمز ${response.status}`,
        latencyMs,
        missingEnv,
      };
    }

    return { status: 'ok', message: 'الاتصال بـ Supabase يعمل', latencyMs, missingEnv };
  } catch {
    // لا نُمرّر تفاصيل الاستثناء للواجهة — قد تكشف بنية الشبكة الداخلية
    return {
      status: 'unreachable',
      message: 'تعذّر الوصول إلى Supabase (تحقق من العنوان أو تشغيل الخدمة محليًا)',
      latencyMs: null,
      missingEnv,
    };
  } finally {
    clearTimeout(timer);
  }
}

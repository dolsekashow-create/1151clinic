import { NextResponse } from 'next/server';
import { publicEnv } from '@/config/env';
import { checkSupabaseHealth } from '@/infrastructure/supabase/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * فحص صحة التشغيل — للمراقبة و CI.
 *
 * ⚠️ لا يكشف أي أسرار: لا مفاتيح، ولا عناوين داخلية، ولا آثار استثناءات.
 */
export async function GET() {
  const supabase = await checkSupabaseHealth();
  const healthy = supabase.status === 'ok';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      app: {
        name: publicEnv.NEXT_PUBLIC_APP_NAME,
        environment: publicEnv.NEXT_PUBLIC_APP_ENV,
        phase: 2,
      },
      checks: {
        supabase: {
          status: supabase.status,
          // معرّف المشروع عام (يظهر في العنوان أصلًا) — ليس سرًا،
          // ووجوده هنا يختصر تشخيص «أي مشروع أنا متصل به؟»
          projectRef: supabase.projectRef,
          latencyMs: supabase.latencyMs,
          missingEnv: supabase.missingEnv,
        },
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}

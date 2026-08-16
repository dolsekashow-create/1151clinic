import { z } from 'zod';

/**
 * الوصول الوحيد المسموح به لمتغيرات البيئة.
 *
 * قواعد:
 * • متغيرات NEXT_PUBLIC_* تصل للمتصفح ⇒ ممنوع أن تحمل أسرارًا.
 * • الأسرار تُقرأ من `serverEnv()` فقط، وهي تُستدعى في الخادم حصرًا.
 * • لا نُسقط البناء عند نقص الإعداد — نُبلّغ بوضوح ونعطّل ما يعتمد عليه،
 *   لأن كسر البناء بسبب بيئة ناقصة يعطّل النشر بلا فائدة أمنية.
 */

/* --------------------------------- عام ----------------------------------- */

const publicSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('النظام المركزي لإدارة الفروع'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

/**
 * ⚠️ يجب كتابة `process.env.X` صراحةً (لا `process.env[key]`) — Next.js
 * يستبدل هذه المراجع نصيًا وقت البناء، والوصول الديناميكي يُنتج undefined.
 */
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const publicEnv = parsedPublic.success
  ? parsedPublic.data
  : publicSchema.parse({
      NEXT_PUBLIC_APP_NAME: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_APP_ENV: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    });

/** هل إعدادات Supabase العامة مكتملة؟ */
export const isSupabaseConfigured =
  Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL) && Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** قائمة المتغيرات العامة الناقصة — للعرض في فحص الصحة. */
export function missingPublicEnv(): string[] {
  const missing: string[] = [];
  if (!publicEnv.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

/**
 * يُرجع إعدادات Supabase العامة أو يرمي خطأ واضحًا.
 * يُستدعى فقط عند إنشاء عميل فعلي — لا عند تحميل الوحدة.
 */
export function requireSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      `إعداد Supabase غير مكتمل. المتغيرات الناقصة: ${missingPublicEnv().join(', ')}. ` +
        'انسخ .env.example إلى .env.local وأكمل القيم (راجع docs/DEPLOYMENT.md §2).',
    );
  }
  return { url, anonKey };
}

/* -------------------------------- الخادم --------------------------------- */

const serverSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  INTERNAL_WEBHOOK_SECRET: z.string().min(16).optional(),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  NOTIFICATIONS_SMS_PROVIDER: z.string().default('console'),
  NOTIFICATIONS_EMAIL_PROVIDER: z.string().default('console'),
  LEGACY_INTEGRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * إعدادات الخادم (تشمل الأسرار).
 * ⚠️ ممنوع استدعاؤها من أي مكوّن يحمل "use client".
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  cachedServerEnv = serverSchema.parse({
    APP_ENV: process.env.APP_ENV,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    INTERNAL_WEBHOOK_SECRET: process.env.INTERNAL_WEBHOOK_SECRET,
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
    NOTIFICATIONS_SMS_PROVIDER: process.env.NOTIFICATIONS_SMS_PROVIDER,
    NOTIFICATIONS_EMAIL_PROVIDER: process.env.NOTIFICATIONS_EMAIL_PROVIDER,
    LEGACY_INTEGRATION_ENABLED: process.env.LEGACY_INTEGRATION_ENABLED,
  });
  return cachedServerEnv;
}

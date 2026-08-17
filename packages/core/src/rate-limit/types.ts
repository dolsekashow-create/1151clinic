import { errors } from '../errors';

/**
 * تجريد الحد من المعدّل (Rate Limiting).
 *
 * الغرض المعماري: نقاط الدخول تقول «افحص الحد» ولا تعرف كيف يُخزَّن العدّاد.
 * تغيير المخزن لاحقًا (Redis / Postgres / Upstash) = صنف جديد يُنفّذ RateLimiter،
 * بلا تعديل في أي مستدعٍ — نفس نمط NotificationProvider.
 *
 * ⚠️ المرحلة 0 تبني **الأساس** فقط. المخزن الافتراضي في الذاكرة، وهو كافٍ
 *    للتطوير وخادم واحد، لكنه **غير كافٍ** على Vercel: كل نسخة (instance)
 *    تحمل عدّادها الخاص، فالحد الفعلي = الحد × عدد النسخ.
 *    قبل فتح أي API عامة (المرحلة 6) يجب استبداله بمخزن مشترك.
 */

export interface RateLimitRule {
  /** عدد المحاولات المسموح بها داخل النافذة. */
  readonly limit: number;
  /** طول النافذة بالميلي ثانية. */
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** الوقت المتبقي حتى إعادة التعيين بالميلي ثانية. */
  readonly resetAfterMs: number;
}

export interface RateLimiter {
  readonly name: string;
  /**
   * يسجّل محاولة ويُرجع القرار.
   * @param key مفتاح التجميع — يجب أن يكون **مُجزّأً** لا قيمة خام
   *            (لا بريد ولا IP صريحًا) لتفادي تخزين بيانات شخصية في العدّادات.
   */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  /** يُصفّر العدّاد — يُستدعى بعد نجاح العملية حتى لا تُعاقب المحاولات الناجحة. */
  reset(key: string): Promise<void>;
}

/** حدود النقاط الحسّاسة. قيم محافظة قابلة للمراجعة عند القياس الفعلي. */
export const RATE_LIMITS = {
  /** تسجيل الدخول: يحمي من تخمين كلمات المرور. */
  login: { limit: 8, windowMs: 10 * 60_000 },
  /** طلب استعادة كلمة المرور: يحمي من إغراق البريد وتعداد الحسابات. */
  passwordReset: { limit: 4, windowMs: 15 * 60_000 },
  /** تعيين كلمة مرور جديدة. */
  passwordUpdate: { limit: 6, windowMs: 15 * 60_000 },
  /** الحجز العام — يُستخدم في المرحلة 6. */
  publicBooking: { limit: 5, windowMs: 60 * 60_000 },
  /** استعلام الأوقات المتاحة — أعلى لأنه قراءة. */
  publicAvailability: { limit: 60, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKind = keyof typeof RATE_LIMITS;

/**
 * مخزن في الذاكرة بنافذة ثابتة.
 *
 * ⚠️ حدوده المعروفة (موثّقة لا مُخفاة):
 *    • لا يُشارَك بين نسخ الخادم ⇒ الحد الفعلي يتضاعف بعدد النسخ.
 *    • يُفقد عند إعادة التشغيل.
 *    • نافذة ثابتة لا منزلقة ⇒ يسمح بذروة على حدّ النافذتين.
 *    مقبول للتطوير وكأساس؛ غير مقبول لحماية نقطة عامة في الإنتاج.
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly name = 'in-memory';

  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = Date.now();
    this.evictExpired(now);

    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, remaining: rule.limit - 1, resetAfterMs: rule.windowMs };
    }

    bucket.count += 1;
    const resetAfterMs = bucket.resetAt - now;

    if (bucket.count > rule.limit) {
      return { allowed: false, remaining: 0, resetAfterMs };
    }

    return { allowed: true, remaining: rule.limit - bucket.count, resetAfterMs };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** تنظيف النوافذ المنتهية + حد أقصى للحجم يمنع نمو الذاكرة بلا سقف. */
  private evictExpired(now: number): void {
    if (this.buckets.size < this.maxEntries) {
      // تنظيف رخيص: لا نمرّ على كل المفاتيح في كل استدعاء
      if (this.buckets.size % 64 !== 0) return;
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    // لو بقي الحجم فوق الحد بعد التنظيف، نُفرغ الأقدم
    if (this.buckets.size >= this.maxEntries) {
      const excess = this.buckets.size - Math.floor(this.maxEntries * 0.8);
      let removed = 0;
      for (const key of this.buckets.keys()) {
        this.buckets.delete(key);
        if (++removed >= excess) break;
      }
    }
  }
}

/** مُعطِّل — يسمح دائمًا. يُستخدم عند إيقاف الحد من الإعدادات. */
export class NoopRateLimiter implements RateLimiter {
  readonly name = 'disabled';
  async consume(): Promise<RateLimitResult> {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAfterMs: 0 };
  }
  async reset(): Promise<void> {}
}

/**
 * يرمي RATE_LIMITED إذا تجاوز الحد.
 * الرسالة عامة ولا تكشف الحد ولا العدّاد — كشفهما يساعد المهاجم على المعايرة.
 */
export function assertWithinLimit(result: RateLimitResult): void {
  if (!result.allowed) {
    throw errors.rateLimited(Math.ceil(result.resetAfterMs / 1000));
  }
}

import 'server-only';

import type { RateLimitResult, RateLimitRule, RateLimiter } from '@erp/core';
/*
  ⚠️ استيراد مقيّد بقاعدة ESLint — والاستثناء هنا واعٍ وموثّق.

  جدول العدّادات مغلق أمام `anon` و`authenticated` عمدًا (بلا أي سياسة RLS)،
  والدالة ممنوحة لـ`service_role` وحده. فتحها لدور العميل كان يعني أن الزائر
  يستطيع استهلاك عدّادات غيره أو تصفير حدّه هو — أي إلغاء الحماية من داخلها.
  المفتاح هنا **لا يقرأ أي جدول تشغيلي ولا يتخذ أي قرار تصريح**.
  راجع docs/SECURITY.md §4.
*/
// eslint-disable-next-line no-restricted-imports
import { createAdminClient, isAdminClientAvailable } from '@/infrastructure/supabase/admin';

/**
 * مخزن الحد من المعدّل في PostgreSQL — مشترك بين كل نسخ الخادم.
 *
 * لماذا هذا بديلًا عن المخزن في الذاكرة:
 *   Vercel يشغّل نسخًا متعددة، والعدّاد في ذاكرة نسخة لا تراه الأخرى ⇒ الحد
 *   الفعلي يتضاعف بعدد النسخ، ويُفقد عند كل إعادة تشغيل. هذا مقبول للتطوير
 *   وغير مقبول لحماية نقطة **عامة**.
 *
 * ⚠️ يستخدم مفتاح الخدمة لسبب واحد: جدول العدّادات مغلق أمام `anon` و
 *    `authenticated` عمدًا (لا سياسة RLS عليه إطلاقًا). فتحه لدور العميل كان
 *    يعني أن الزائر يستطيع استهلاك عدّادات غيره أو تصفيرها. المفتاح **لا
 *    يُستخدم في أي قرار تصريح**، ولا يُمرَّر إلى المتصفح، ولا يُستعمل لقراءة
 *    أي بيانات — نداء واحد لدالة عدّاد لا تقرأ أي جدول تشغيلي.
 *
 * ⚠️ المفتاح المُمرَّر **مُجزّأ دائمًا** من `buildKey` — لا IP ولا هاتف ولا بريد
 *    يصل إلى قاعدة البيانات.
 */
export class PostgresRateLimiter implements RateLimiter {
  readonly name = 'postgres';

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (!isAdminClientAvailable()) {
      /*
        ⚠️ الفشل المفتوح مقصود هنا وموثّق: تعطيل الخدمة العامة كليًا لأن مخزن
           العدّادات غير مهيّأ أسوأ من السماح بمرور الطلبات. الحماية الحقيقية
           ضد إساءة الاستخدام تبقى في قاعدة البيانات (قيد التعارض، بوابة
           النشر، عدم التكرار) لا في العدّاد.
      */
      console.error('[rate-limit] مخزن العدّادات غير مهيّأ — مرّ الطلب بلا حد');
      return { allowed: true, remaining: rule.limit, resetAfterMs: rule.windowMs };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('consume_rate_limit', {
      p_bucket_key: key,
      p_limit: rule.limit,
      p_window_seconds: Math.ceil(rule.windowMs / 1000),
    });

    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      console.error('[rate-limit] تعذّر استهلاك العدّاد', error?.message);
      return { allowed: true, remaining: rule.limit, resetAfterMs: rule.windowMs };
    }

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      // الواجهة تتعامل بالمدة المتبقية لا باللحظة المطلقة
      resetAfterMs: Math.max(0, new Date(row.reset_at).getTime() - Date.now()),
    };
  }

  /**
   * ⚠️ لا يُصفّر شيئًا عمدًا.
   *    التصفير بعد النجاح منطقي في تسجيل الدخول (نجاح = ليس مهاجمًا)، لكنه في
   *    الحجز العام يعني أن من ينجح في حجز يستعيد رصيده كاملًا فورًا — فيصنع
   *    حجوزات بلا حد. الحد هنا يجب أن يُحتسب على المحاولات الناجحة أيضًا.
   */
  async reset(): Promise<void> {
    // لا شيء — انظر التعليق أعلاه.
  }
}

import { describe, expect, it } from 'vitest';
import { z, type ZodTypeAny } from 'zod';

/**
 * اختبار انحدار لخلل حقيقي أوقف النظام بالكامل عند المستخدم.
 *
 * الأعراض: تسجيل الدخول يفشل بـ«حدث خطأ غير متوقع»، وصفحة المستخدمين تُرجع
 * INTERNAL_ERROR، و«معظم الاختيارات فيها مشاكل».
 *
 * السبب: من ينسخ `.env.example` كما هو يحصل على متغيرات بقيم **فارغة**
 * (`SUPABASE_SECRET_KEY=`). مخطط zod كان يعتبر الفارغ قيمة غير صالحة فيفشل
 * `.min(1)` ويُسقط تحليل البيئة كله — وكل فعل في الخادم يستدعيه.
 *
 * القاعدة الصحيحة: **المتغيّر الفارغ يعني «غير مضبوط» لا «قيمة خاطئة»**،
 * والتحقق من الشكل يقع بعد ذلك لا قبله.
 *
 * ⚠️ الاختبار على النمط لا على ملف التطبيق: `apps/web/src/config/env.ts`
 *    يستورد `server-only` فلا يعمل خارج Next. النمط هو محل الخطأ، وتثبيته هنا
 *    يمنع تكراره في أي مخطط بيئة قادم.
 */

const emptyAsUndefined = <T extends ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

describe('تحليل متغيرات البيئة', () => {
  const schema = z.object({
    secret: emptyAsUndefined(z.string().min(1).optional()),
    webhook: emptyAsUndefined(z.string().min(16).optional()),
    flag: emptyAsUndefined(
      z
        .enum(['true', 'false'])
        .default('true')
        .transform((v: 'true' | 'false') => v === 'true'),
    ),
    name: emptyAsUndefined(z.string().min(1).default('افتراضي')),
  });

  it('⭐ القيمة الفارغة تُعامَل كغير مضبوطة لا كقيمة خاطئة', () => {
    const parsed = schema.parse({ secret: '', webhook: '', flag: '', name: '' });
    expect(parsed.secret).toBeUndefined();
    expect(parsed.webhook).toBeUndefined();
    expect(parsed.flag).toBe(true);
    expect(parsed.name).toBe('افتراضي');
  });

  it('المسافات وحدها تُعامَل كفراغ', () => {
    expect(schema.parse({ secret: '   ' }).secret).toBeUndefined();
  });

  it('الغياب التام يبقى مقبولًا', () => {
    const parsed = schema.parse({});
    expect(parsed.secret).toBeUndefined();
    expect(parsed.flag).toBe(true);
  });

  it('القيمة الصحيحة تمر كما هي', () => {
    const parsed = schema.parse({
      secret: 'sb_secret_example',
      webhook: 'x'.repeat(20),
      flag: 'false',
      name: 'اسم المنشأة',
    });
    expect(parsed.secret).toBe('sb_secret_example');
    expect(parsed.flag).toBe(false);
    expect(parsed.name).toBe('اسم المنشأة');
  });

  it('القيمة غير الصالحة تبقى مرفوضة — التساهل عن الفراغ ليس قبولًا لأي شيء', () => {
    expect(() => schema.parse({ webhook: 'short' })).toThrow();
    expect(() => schema.parse({ flag: 'maybe' })).toThrow();
  });

  it('⭐ متغيّر فارغ واحد لا يُسقط بقية المتغيرات الصحيحة', () => {
    // هذا ما كان يحدث: التحقق يفشل كليًا فتُهمل القيم الصحيحة وتُستبدل بالافتراضيات
    const parsed = schema.parse({ secret: '', name: 'اسم صحيح' });
    expect(parsed.name).toBe('اسم صحيح');
  });
});

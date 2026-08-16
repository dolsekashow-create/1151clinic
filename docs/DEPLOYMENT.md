# DEPLOYMENT — التشغيل والنشر

---

## 1. المتطلبات

| الأداة | الإصدار |
|--------|---------|
| Node.js | ≥ 20.11 (مُختبَر على 24.x) |
| pnpm | 9.x (عبر `corepack enable`) |
| Supabase CLI | أحدث إصدار |
| Docker Desktop | لتشغيل Supabase محليًا (اختياري في Phase 1) |

## 2. التشغيل المحلي

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

التطبيق على http://localhost:3000

### تشغيل Supabase محليًا (يبدأ الاحتياج له من Phase 2)

```bash
supabase start
```

انسخ `API URL` و `anon key` الظاهرين في المخرجات إلى `.env.local`، ثم:

```bash
pnpm db:reset
pnpm db:types
```

## 3. البيئات

| البيئة | الفرع | Supabase | الرابط |
|--------|-------|----------|--------|
| development | أي فرع محلي | مشروع محلي (Docker) | localhost:3000 |
| staging | `develop` | مشروع Supabase منفصل | Vercel Preview |
| production | `main` | مشروع Supabase للإنتاج | نطاق الشركة |

**قاعدة صارمة:** لكل بيئة **مشروع Supabase منفصل**. ممنوع مشاركة قاعدة بيانات الإنتاج مع الاختبار.

## 4. متغيرات البيئة على Vercel

| المتغير | Production | Preview | Development |
|---------|-----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (Sensitive) | ✅ | ✅ |
| `NEXT_PUBLIC_APP_URL` | ✅ | ✅ | ✅ |
| `APP_ENV` | `production` | `staging` | `development` |

> علّم كل الأسرار كـ **Sensitive** في Vercel حتى لا تُقرأ بعد الحفظ.

## 5. النشر

```
git push origin develop   → Vercel Preview  → مشروع Supabase (staging)
git push origin main      → Vercel Production → مشروع Supabase (production)
```

إعدادات Vercel:
- Framework: **Next.js**
- Root Directory: `apps/web`
- Install Command: `pnpm install`
- Build Command: `pnpm turbo run build --filter=@erp/web`

## 6. ترحيلات قاعدة البيانات

```bash
supabase link --project-ref <ref>
supabase db push          # تطبيق الترحيلات على البيئة المرتبطة
```

**الترتيب الإلزامي:** الترحيلات تُطبَّق **قبل** نشر الكود الذي يعتمد عليها.
**ممنوع** تعديل ملف ترحيل سبق تطبيقه — يُضاف ملف جديد.

## 7. قائمة التحقق قبل الإنتاج

- [ ] كل الجداول عليها RLS مُفعّلة ومختبرة
- [ ] لا يوجد `service_role` key في أي كود عميل
- [ ] `.env` غير موجود في Git
- [ ] اختبارات RLS والصلاحيات تمر
- [ ] النسخ الاحتياطي مُفعّل على مشروع Supabase
- [ ] Security headers مفعّلة
- [ ] مراجعة سجلات التدقيق تعمل
- [ ] خطة استعادة موثّقة ومجرّبة

## 8. ملاحظة على حدود Vercel

Vercel مناسب لدورة الطلب/الاستجابة. المهام التالية **لا تُنفَّذ عليه**:
- مزامنة طويلة مع النظام القديم
- تقارير ثقيلة على بيانات ضخمة
- مهام مجدولة مستمرة

الحل عند الحاجة: Supabase Edge Functions / `pg_cron`، أو خدمة `services/api` مستقلة تستهلك `packages/core` (راجع [ARCHITECTURE.md](./ARCHITECTURE.md) §2).

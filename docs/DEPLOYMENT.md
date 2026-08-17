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
pnpm install
```

⚠️ **موقع ملف البيئة:** Next.js يقرأ البيئة من **جذر التطبيق** لا من جذر المستودع:

```bash
cp apps/web/.env.example apps/web/.env.local
```

```bash
pnpm dev
```

التطبيق على http://localhost:3000 · فحص الصحة: `GET /api/health`

### ملء متغيرات Supabase

من لوحة Supabase ← **Project Settings**:

| المتغير | المصدر |
|---------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Data API ← Project URL (أو `https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | API Keys ← **Publishable key** (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | API Keys ← **Secret key** (`sb_secret_…`) — اختياري، للعمليات الإدارية فقط |

تحقق من الاتصال:

```bash
curl -s http://localhost:3000/api/health
```

الحالات المحتملة: `ok` · `not_configured` (متغيرات ناقصة) · `invalid_key` (المشروع
موجود والمفتاح مرفوض) · `unreachable` (لا استجابة).

### اختبار قاعدة البيانات بلا Docker

```bash
pnpm test:rls
```

يشغّل PostgreSQL مضمّنًا ويطبّق كل الترحيلات — لا يحتاج Docker ولا Supabase CLI.

### تشغيل Supabase محليًا (اختياري — يحتاج Docker)

```bash
supabase start
```

ثم `pnpm db:reset`.

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
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SECRET_KEY` | ✅ (Sensitive) | ✅ (Sensitive) | اختياري |
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
npx supabase login
```

```bash
npx supabase link --project-ref aaqofsfgizkeiwusmckk
```

```bash
npx supabase db push
```

ثم البذور المرجعية (الصلاحيات والأدوار) عبر SQL Editor في لوحة Supabase أو:

```bash
psql "$DATABASE_URL" -f supabase/seed/01_permissions_roles.sql
```

**الترتيب الإلزامي:** الترحيلات تُطبَّق **قبل** نشر الكود الذي يعتمد عليها.
**ممنوع** تعديل ملف ترحيل سبق تطبيقه — يُضاف ملف جديد.

⚠️ `supabase link` يتطلب Access Token (تسجيل دخول) وكلمة مرور قاعدة البيانات.
كلاهما بحوزة مالك المشروع فقط ولا يُوضع في المستودع.

### أول مستخدم (bootstrap)

لا يمكن إنشاء أول مستخدم من الواجهة لأن التسجيل الذاتي معطّل عمدًا. الخطوات:

1. أنشئ المستخدم من لوحة Supabase ← Authentication ← Add user.
2. أضف صف `organizations` وصف `branches` عبر SQL Editor.
3. أضف صف `profiles` بنفس `id` المستخدم و`organization_id` المنشأة.
4. أسند دور `company_admin` بنطاق `organization` في `user_roles`.

بعدها يستطيع هذا المستخدم إدارة الباقي من التطبيق.

## 7. قائمة التحقق قبل الإنتاج

- [x] كل الجداول عليها RLS مُفعّلة (اختبار تغطية يفرضها)
- [x] اختبارات RLS والصلاحيات تمر (38 اختبارًا)
- [x] لا مفتاح سرّي في أي كود عميل (`server-only` + فحص CI)
- [x] `.env` غير موجود في Git
- [x] Security headers مفعّلة
- [ ] الترحيلات مُطبَّقة على مشروع Supabase وتم التحقق منها هناك
- [ ] مفتاح Publishable صالح ومُختبَر (`/api/health` يُرجع `ok`)
- [ ] Rate limiting صريح على مسارات الدخول
- [ ] CSP مضبوطة
- [ ] النسخ الاحتياطي مُفعّل على مشروع Supabase
- [ ] خطة استعادة موثّقة ومجرّبة
- [ ] اختبارات E2E للمسارات الحرجة

## 8. ملاحظة على حدود Vercel

Vercel مناسب لدورة الطلب/الاستجابة. المهام التالية **لا تُنفَّذ عليه**:
- مزامنة طويلة مع النظام القديم
- تقارير ثقيلة على بيانات ضخمة
- مهام مجدولة مستمرة

الحل عند الحاجة: Supabase Edge Functions / `pg_cron`، أو خدمة `services/api` مستقلة تستهلك `packages/core` (راجع [ARCHITECTURE.md](./ARCHITECTURE.md) §2).

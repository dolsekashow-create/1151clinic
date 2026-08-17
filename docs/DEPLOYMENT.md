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

## 2.1 بيئة التطوير/الاختبار (Development / Staging)

آخر تحقق: **2026-08-17** · **الترحيلات الثمانية مُطبَّقة ومُتحقَّق منها على البعيد**

| البند | الحالة |
|-------|--------|
| Project Ref | **`axtezcgdkdkdyflbdndv`** (الاسم على اللوحة: `14clinic`) |
| Project URL | `https://axtezcgdkdkdyflbdndv.supabase.co` |
| PostgreSQL | **17.6.1.155** · eu-west-1 · `ACTIVE_HEALTHY` |
| Publishable Key | ✅ صالح |
| GoTrue (Auth) | ✅ `v2.195.0` |
| اتصال التطبيق (`/api/health`) | ✅ `status: ok` · ~329ms |
| حماية المسارات | ✅ `/dashboard` → 307 → `/login` |
| Supabase CLI | ✅ **2.114.0** — اعتمادية تطوير داخل المشروع |
| الربط | ✅ مرتبط (`supabase/.temp/`) |
| الترحيلات على البعيد | ✅ **8 / 8 مُطبَّقة** |

### التحقق الفعلي من قاعدة البيانات البعيدة

نُفِّذ عبر `supabase db query --linked` على الكتالوج مباشرةً — لا تخمين:

| المؤشر | البعيد | المحلي | مطابق؟ |
|--------|--------|--------|--------|
| جداول `public` | 42 | 42 | ✅ |
| جداول `integration` | 3 | 3 | ✅ |
| جداول عليها RLS | **42** | 42 | ✅ |
| جداول **بلا** RLS | **0** | 0 | ✅ |
| سياسات RLS | **126** | 126 | ✅ |
| دوال مخطط `app` | **16** | 16 | ✅ |
| المحفّزات | **40** | 40 | ✅ |
| الفهارس | **181** | 181 | ✅ |
| المفاتيح الأجنبية | **137** | 137 | ✅ |

**الثوابت الأمنية على البعيد:**

| الفحص | النتيجة |
|-------|---------|
| دوال `app` ممنوحة لـ`PUBLIC` | **0** ✅ (إصلاح CRITICAL-01 فعّال) |
| دوال `app` متاحة لـ`authenticated` | **6** ✅ (دوال القراءة حصرًا) |
| `SECURITY DEFINER` بلا `search_path` | **0** ✅ |
| سياسات UPDATE/ALL بلا `WITH CHECK` | **0** ✅ |
| سياسات تعديل/حذف على الدفاتر | **0** ✅ |
| جداول متبقية من أي مخطط آخر | **0** ✅ |

**حالة البيانات:** `permissions` = 0 · `roles` = 0 · `profiles` = 0 — **لا بذور ولا مستخدمين ولا بيانات تجربة** (متعمّد).

### ملاحظات أمنية على المشروع

| البند | القيمة | التوصية |
|-------|--------|---------|
| `disable_signup` | `false` ⚠️ | التسجيل الذاتي مفتوح لمن يملك المفتاح العام. `config.toml` يضبطه `false` لكنه يخص التشغيل المحلي فقط. **عطّله من لوحة التحكم قبل إنشاء أي مستخدم.** |
| `mailer_autoconfirm` | `false` | تأكيد البريد مطلوب ⇒ مستخدمو التجربة يُنشأون من اللوحة |
| مزودو الدخول | `email: true` · `phone: false` | البريد فقط — يوافق افتراض التطوير AS-03 |

### درس مُوثَّق: طوابع الترحيلات الزمنية

ملفان كانا بطابع غير صالح (`…006000` و`…007000` ⇒ الدقيقة 60 و70). أُعيدت
تسميتهما إلى `20260817060000` و`20260817070000` **قبل** الدفع.

⚠️ **إعادة التسمية بعد الدفع مكلفة**: الاسم يُسجَّل في
`supabase_migrations.schema_migrations` على البعيد، فيقع انفصال بين المحلي والبعيد.
**تحقق دائمًا من صلاحية الطابع (`YYYYMMDDHHMMSS`) قبل أول `db push`.**

### المشروع السابق (مهجور)

`aaqofsfgizkeiwusmckk` — هُجر لأنه احتوى مخططًا مختلفًا (15 جدولًا بأسماء
متشابهة وأعمدة مغايرة، أهمها `customers` **بلا `branch_id`** ⇒ استحالة عزل الفروع).
ترحيلاتنا تستخدم `create table if not exists` فكانت ستتخطى الجداول القائمة بصمت
وتُنتج مخططًا هجينًا مكسورًا. **لا يُستخدم هذا المشروع بعد الآن.**

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

## 4.1 جاهزية GitHub و Vercel — حالة 2026-08-17

| البند | الحالة |
|-------|--------|
| البناء | ✅ `pnpm build` ينجح · 9 مسارات + Middleware 107kB |
| الفرع | `main` · 6 التزامات · **لا push** (بانتظار إذن) |
| GitHub remote | ❌ **غير مُهيّأ** — لا يمكن الدفع |
| `gh` CLI | ❌ غير مثبت |
| Vercel CLI | ❌ غير مثبت |
| أسرار متتبَّعة في Git | ✅ **صفر** — مؤكَّد بفحص كل الملفات المتتبَّعة |

### الخطوة المطلوبة منك — إنشاء المستودع

```bash
git remote add origin https://github.com/<user>/<repo>.git
```

```bash
git push -u origin main
```

أو عبر `gh` بعد تثبيته وتسجيل الدخول:

```bash
gh repo create <repo> --private --source=. --push
```

### إعدادات Vercel

| الإعداد | القيمة |
|---------|--------|
| Framework | Next.js |
| Root Directory | `apps/web` |
| Install Command | `pnpm install` |
| Build Command | `pnpm turbo run build --filter=@erp/web` |
| Node.js | 20.x أو أحدث |

### متغيرات البيئة على Vercel

| المتغير | القيمة | النطاق | حساسية |
|---------|--------|--------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://axtezcgdkdkdyflbdndv.supabase.co` | Preview + Development | — |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | مفتاح Publishable | Preview + Development | — |
| `NEXT_PUBLIC_APP_URL` | عنوان النشر | كل النطاقات | — |
| `NEXT_PUBLIC_APP_NAME` | اسم النظام | كل النطاقات | — |
| `APP_ENV` | `staging` | Preview | — |
| `SUPABASE_SECRET_KEY` | مفتاح Secret | **Server فقط** | ✅ **Sensitive** |

### ⛔ قواعد إلزامية للمفتاح السري على Vercel

1. **ممنوع** أن يُسمّى `NEXT_PUBLIC_*` — أي متغيّر بهذه البادئة يُدمج نصيًا في حزمة المتصفح ويصبح مقروءًا لأي زائر.
2. يُعلَّم **Sensitive** في Vercel ⇒ لا يُقرأ بعد الحفظ.
3. يُقرأ في الكود من [`admin.ts`](../apps/web/src/infrastructure/supabase/admin.ts) الذي يستورد `server-only` ⇒ أي استيراد من مكوّن عميل **يفشل عند البناء**.
4. النظام يعمل كاملًا بدونه؛ غيابه يعطّل العمليات الإدارية فقط.

> ⚠️ **لا تربط بيئة التطوير الحالية بنطاق Production.** لا يوجد مشروع Supabase
> إنتاجي بعد، وبيانات هذه البيئة تجريبية بالكامل (منشأة `DEMO` وبريد `@demo.local`).

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

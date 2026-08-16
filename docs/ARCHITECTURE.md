# ARCHITECTURE — النظام المركزي لإدارة الفروع

> **الحالة:** Phase 1 (Foundation) — مُنفّذة.
> **المبدأ الحاكم:** نبني *البنية* الآن، ونترك *قواعد العمل غير المعتمدة* قابلة للتهيئة (`BUSINESS_RULE_PENDING`) بدل تخمينها.

---

## 1. نظرة عامة

منصة ويب مركزية واحدة لإدارة عمليات شركة بأكثر من 15 فرعًا: مستخدمون، صلاحيات، عملاء، حجوزات، خدمات، مخازن، مشتريات، موردون، خزائن، ورديات، حركات مالية، إشعارات، تقارير، وسجلات تدقيق.

تعمل بالتوازي مع النظام القديم في المرحلة الأولى — بدون أي اعتماد تقني عليه.

### الخصائص غير الوظيفية المُلزِمة (Non-Functional Requirements)

| # | الخاصية | كيف تتحقق معماريًا |
|---|---------|--------------------|
| 1 | Multi-Branch isolation | `organization_id` + `branch_id` على كل جدول تشغيلي + RLS في PostgreSQL |
| 2 | Permission-Based | RBAC حقيقي في قاعدة البيانات + فحص مزدوج (DB + Server) |
| 3 | Security | Defense in depth: RLS → Server Authorization → Validation → UI |
| 4 | Modularity | حدود Modules صريحة + طبقات داخل كل Module |
| 5 | Arabic / RTL First | `dir="rtl"` على مستوى الـ document + Design Tokens منطقية (start/end) |
| 6 | Scalability | Stateless app + Postgres مفهرس + إمكانية استخراج Backend لاحقًا |
| 7 | Auditability | `audit_logs` + أعمدة `created_by` / `updated_by` على الجداول الحساسة |

---

## 2. قرار البنية الأساسي: Modular Monolith على Next.js

### القرار

**Next.js (App Router) كطبقة عرض + طبقة API معًا، مع منطق العمل معزول في طبقة مستقلة عن الإطار.**

لا يوجد خادم Backend منفصل في هذه المرحلة.

### لماذا (وليس Backend منفصل من اليوم الأول)

| المعيار | Next.js Full-Stack | Backend منفصل (NestJS/Fastify) |
|---------|--------------------|-------------------------------|
| سرعة تسليم Foundation | ✅ عالية | ❌ ضعف الوقت |
| Deployment | ✅ Vercel + Supabase فقط | ❌ خدمة إضافية + شبكة + مراقبة |
| Auth session (cookies) | ✅ متكامل مع `@supabase/ssr` | ⚠️ يحتاج جسر توكنات |
| أمان البيانات | ✅ RLS في Postgres هي خط الدفاع الأول بأي حال | ✅ نفسه |
| فريق صغير / متطلبات غير مكتملة | ✅ الأنسب | ❌ تكلفة تشغيل بلا عائد |
| مهام طويلة / Cron / Workers | ⚠️ محدودة على Vercel | ✅ أفضل |

**المخاطر مُدارة، لا مُتجاهَلة:** البند الأخير (مهام طويلة/تكاملات ثقيلة) هو السبب الوحيد الحقيقي لخادم منفصل، وهو غير مطلوب الآن. لذلك:

> منطق العمل **لا يُكتب** داخل مكوّنات Next ولا داخل Route Handlers.
> يُكتب في `packages/core` (TypeScript خالص، بلا أي `import` من `next/*`).
> عند الحاجة لاستخراج Backend مستقل مستقبلًا، ننقل `packages/core` كما هي ونضع فوقها HTTP adapter — بدون إعادة كتابة.

هذا هو **معيار القبول** الذي يمنع الالتصاق بالإطار: أي كود في `packages/core` يستورد من `next` يُعتبر خرقًا معماريًا.

### متى نعيد النظر (Trigger for extraction)

- ظهور مهام تتجاوز حدود زمن التنفيذ على Vercel (مزامنة النظام القديم، تقارير ثقيلة).
- الحاجة لجدولة مستمرة (Schedulers) أو طوابير (Queues).
- عملاء آخرون (Mobile / نظام قديم) يحتاجون نفس الـ API.

عندها: `services/api` جديدة تستهلك `packages/core` — والقرار مُوثّق مسبقًا هنا.

---

## 3. الطبقات (Layered Architecture)

```
┌───────────────────────────────────────────────────────────────┐
│ Presentation      apps/web/src/app/**            (RSC/Client) │
│                   apps/web/src/modules/*/ui/**                │
├───────────────────────────────────────────────────────────────┤
│ API / Transport   Server Actions + Route Handlers             │
│                   • مصادقة الجلسة   • التحقق من المدخلات      │
│                   • فحص الصلاحية    • تحويل الأخطاء لِـ envelope│
├───────────────────────────────────────────────────────────────┤
│ Application       packages/core/src/<module>/use-cases        │
│  (Use Cases)      • تنسيق العمليات  • لا تعرف HTTP ولا React   │
├───────────────────────────────────────────────────────────────┤
│ Domain            packages/core/src/<module>/domain           │
│                   • Entities • Value Objects • Policies       │
│                   • BUSINESS_RULE_PENDING registry            │
├───────────────────────────────────────────────────────────────┤
│ Data Access       apps/web/src/infrastructure/**  (Repos)     │
│                   • Supabase queries فقط هنا                   │
├───────────────────────────────────────────────────────────────┤
│ Infrastructure    Supabase (Postgres/Auth/Storage/Realtime)   │
│                   Notification providers • Legacy adapters    │
└───────────────────────────────────────────────────────────────┘
```

**قواعد الاتجاه (Dependency Rule):** الأسهم تتجه للأسفل فقط. Domain لا يعرف شيئًا عن أي طبقة فوقه.

---

## 4. هيكل المستودع (Repository Structure)

```
15clinic/
├─ apps/
│  └─ web/                         تطبيق Next.js (Presentation + API)
│     ├─ src/
│     │  ├─ app/                   App Router
│     │  │  ├─ (auth)/             مسارات عامة: تسجيل الدخول…      [Phase 2]
│     │  │  ├─ (dashboard)/        مسارات محمية داخل الـ Shell
│     │  │  └─ api/                Route Handlers (webhooks/exports)
│     │  ├─ modules/               واجهات وطبقات كل Module
│     │  │  └─ <module>/
│     │  │     ├─ ui/              مكوّنات الواجهة الخاصة بالـ Module
│     │  │     ├─ actions/         Server Actions (transport)
│     │  │     └─ repositories/    Data Access (Supabase)
│     │  ├─ infrastructure/
│     │  │  ├─ supabase/           browser / server / admin clients
│     │  │  ├─ notifications/      Providers                       [Phase 5]
│     │  │  └─ legacy/             Integration adapters            [لاحقًا]
│     │  ├─ shared/                أدوات مشتركة داخل التطبيق
│     │  └─ config/                إعدادات وبيئة مُتحقق منها
│     └─ …
├─ packages/
│  ├─ core/                        Domain + Use Cases (TS خالص)
│  ├─ ui/                          Design System (مستقل عن أي Module)
│  ├─ types/                       أنواع مشتركة + Database types مُولّدة
│  └─ config/                      tsconfig / eslint / prettier presets
├─ supabase/
│  ├─ migrations/                  SQL مرقّمة — مصدر الحقيقة للـ Schema
│  ├─ seed/                        بيانات مرجعية (roles/permissions)
│  └─ functions/                   Edge Functions (عند الحاجة فقط)
├─ docs/                           هذا التوثيق
└─ .github/workflows/              CI
```

### لماذا Monorepo (pnpm + Turborepo) وليس مجلدًا واحدًا؟

1. يفرض **حدودًا فيزيائية** بين الطبقات: `packages/core` لا يستطيع استيراد `next` لأنه ليس ضمن اعتمادياته أصلًا.
2. يسمح بإضافة `apps/admin` أو `services/api` أو تطبيق موبايل لاحقًا بلا إعادة هيكلة.
3. `packages/ui` قابل لإعادة الاستخدام والاختبار بمعزل عن منطق العمل.

> **فرق عن الهيكل المقترح في الطلب:** لم نُنشئ `services/api` الآن لأن ذلك يعني خادمًا فارغًا بلا وظيفة. الاسم محجوز في هذا التوثيق وطريق الانتقال إليه موصوف في §2.

---

## 5. حدود الـ Modules

كل Module هو وحدة منطقية مغلقة، تُصدّر واجهة عامة فقط.

| Module | المسؤولية | حالة قواعد العمل |
|--------|-----------|-------------------|
| `auth` | جلسات، دخول/خروج، استعادة كلمة المرور | مؤكد (تقني) |
| `identity` | المستخدمون، الأدوار، الصلاحيات، ربط الفروع | مؤكد جزئيًا — قائمة الأدوار مبدئية |
| `organizations` | المنشأة، الفروع، الإدارات/الأقسام | مؤكد هيكليًا |
| `customers` | العملاء وبياناتهم الأساسية | مؤكد جزئيًا |
| `services` | الخدمات وتوفرها بالفروع | التسعير `BUSINESS_RULE_PENDING` |
| `appointments` | الحجوزات | الـ Workflow `BUSINESS_RULE_PENDING` |
| `inventory` | المخازن، الأصناف، الحركات | الدورة `BUSINESS_RULE_PENDING` |
| `purchasing` | الطلبات، الموافقات، أوامر الشراء، الاستلام | الـ Workflow `BUSINESS_RULE_PENDING` |
| `finance` | الحركات والقيود المالية، الخزائن، الورديات | القيود `BUSINESS_RULE_PENDING` |
| `notifications` | قوالب، إرسال، حالة التسليم | المزود `REQUIREMENT_PENDING` |
| `reports` | تعريفات التقارير، الفلاتر، التصدير | التقارير `REQUIREMENT_PENDING` |
| `audit` | سجل التدقيق | مؤكد |

### قواعد التواصل بين الـ Modules

1. لا يستورد Module من ملفات داخلية لـ Module آخر — فقط من `index.ts` العام.
2. الترابط بين المجالات (مثال: استلام مخزون ⇒ حركة مالية) يتم عبر **Domain Events**، لا عبر استدعاء مباشر.
   الحدث يحمل: `source_module`, `source_record_id`, `branch_id`, `occurred_at`.
   **هذا يجعل الربط المالي قابلًا للتفعيل/التعديل لاحقًا بلا تغيير في منطق المخزون.**
3. أي قاعدة عمل غير معتمدة تُسجَّل في `packages/core/src/pending/registry.ts` وتُرمى منها استثناء واضح إذا استُدعيت — بدل تنفيذ منطق مُخترَع بصمت.

---

## 6. استراتيجية المصادقة (Authentication) — [Phase 2]

- المزود: **Supabase Auth**. لا نخزّن كلمات مرور ولا نتعامل معها إطلاقًا.
- الجلسة: **Cookie-based** عبر `@supabase/ssr` — تعمل مع Server Components و Middleware.
- تحديث التوكن: في `middleware.ts` (تمرير الكوكيز المحدّثة للاستجابة).
- جدول `profiles` مرتبط 1:1 بـ `auth.users` عبر `id` — لتخزين البيانات التنظيمية (المنشأة، الحالة، الاسم بالعربية).
- **قاعدة صارمة:** لا يُستخدم `getSession()` في السيرفر لاتخاذ قرار أمني — يُستخدم `getUser()` فقط لأنه يتحقق من التوقيع مع خادم Auth.
- جاهزية مستقبلية: Email / Phone / OTP / MFA مدعومة من Supabase Auth بدون تغيير معماري.

## 7. استراتيجية التخويل (Authorization) — [Phase 2]

نموذج RBAC حقيقي، **لا** `isAdmin`:

```
users ─┬─ user_roles ── roles ── role_permissions ── permissions
       └─ user_branches (نطاق الوصول للفروع)
```

- **Permission** نصّي بصيغة `module.action` (مثل `finance.approve`) — إضافة صلاحية = صف جديد، لا كود جديد.
- **Scope**: لكل تعيين دور نطاق: `organization` (كل الفروع) أو `branch` (فروع محددة عبر `user_branches`).
- **الفحص يحدث مرتين — عمدًا:**
  1. **PostgreSQL RLS** — خط الدفاع الحقيقي. حتى لو أخطأ الكود، البيانات محمية.
  2. **Server-side guard** — لإرجاع خطأ 403 واضح ومقروء وتسجيله في الـ audit.
- الواجهة تخفي ما لا يملك المستخدم صلاحيته — **كتحسين تجربة فقط، وليست ضمانًا أمنيًا**.

## 8. عزل الفروع (Multi-Branch Isolation)

كل جدول تشغيلي يحمل:

```sql
organization_id uuid not null references organizations(id)
branch_id       uuid          references branches(id)   -- null = مستوى المنشأة
```

سياسات RLS تُبنى على ثلاث دوال `SECURITY DEFINER STABLE` في مخطط `app`:

| الدالة | الغرض |
|--------|-------|
| `app.current_org_id()` | المنشأة الحالية للمستخدم |
| `app.has_permission(text)` | هل يملك المستخدم هذه الصلاحية؟ |
| `app.can_access_branch(uuid)` | هل يملك وصولًا لهذا الفرع تحديدًا؟ |

قالب السياسة:

```sql
using (
  organization_id = (select app.current_org_id())
  and (select app.can_access_branch(branch_id))
  and (select app.has_permission('customers.view'))
)
```

> `(select …)` مقصود: يجعل PostgreSQL يُقيّم الدالة مرة واحدة (InitPlan) بدل مرة لكل صف — فرق أداء كبير على الجداول الكبيرة.

**اختبار القبول (Phase 7):** مستخدم في الفرع A **يجب** أن يحصل على 0 صفوف من بيانات الفرع B، حتى عند استدعاء الاستعلام مباشرة بمفتاح `anon` متجاوزًا كامل واجهة التطبيق.

## 9. بنية Supabase

| الميزة | الاستخدام | القرار |
|--------|-----------|--------|
| PostgreSQL | مصدر الحقيقة | ✅ من Phase 1 |
| Auth | المصادقة | ✅ Phase 2 |
| RLS | العزل والصلاحيات | ✅ Phase 2 |
| Storage | مستندات ومرفقات | ⏳ عند ظهور الحاجة (Buckets خاصة + سياسات) |
| Realtime | تنبيهات فورية / لوحة عمليات | ⏳ لا يُفعّل بلا حالة استخدام مؤكدة |
| Edge Functions | Webhooks ومهام خارج دورة الطلب | ⏳ عند الحاجة فقط |

> مبدأ: لا تُفعَّل أي ميزة بلا سبب موثّق. كل ميزة مُفعّلة = سطح هجوم + تكلفة صيانة.

## 10. بنية الأمان — انظر [SECURITY.md](./SECURITY.md)

## 11. بنية قاعدة البيانات — انظر [DATABASE.md](./DATABASE.md)

---

## 12. خارطة الطريق (Roadmap)

| Phase | المحتوى | الحالة |
|-------|---------|--------|
| **1 — Foundation** | Monorepo، Next.js، TS، Tailwind v4، اتصال Supabase، البيئة، الهيكل، Design System | ✅ منجزة |
| **2 — Security** | Auth، profiles، RBAC، RLS، عزل المنشأة والفرع | ⬜ التالية |
| **3 — Core** | Organizations، Branches، Departments، Users، Customers، Services | ⬜ |
| **4 — Operations** | أساسات: Appointments، Inventory، Purchasing، Finance، Treasury، Shifts | ⬜ |
| **5 — Notifications** | مركز الإشعارات، تجريد SMS، بنية المزودين | ⬜ |
| **6 — Audit & Reports** | سجل التدقيق، بنية التقارير والتصدير | ⬜ |
| **7 — Testing** | Unit / Integration / Permission / RLS | ⬜ |
| **8 — Deployment** | GitHub → Vercel + Supabase، بيئات، تجهيز الإنتاج | ⬜ |

**قاعدة الانتقال:** لا تبدأ مرحلة قبل أن تكون السابقة: تبني ✅، تعمل ✅، مُختبَرة ✅، موثّقة ✅.

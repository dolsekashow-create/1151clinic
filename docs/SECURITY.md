# SECURITY — نموذج الأمان

> اعتبر كل بيانات هذا النظام **Business-Sensitive**: بيانات مالية، عملاء، مخزون، وتكاليف.

---

## 1. نموذج التهديد (Threat Model)

| # | التهديد | الضابط |
|---|---------|--------|
| T1 | موظف فرع A يقرأ بيانات فرع B | RLS في Postgres (لا يمكن تجاوزه من العميل) |
| T2 | استدعاء PostgREST مباشرة بمفتاح `anon` متجاوزًا الواجهة | RLS — الواجهة ليست حاجزًا أمنيًا أصلًا |
| T3 | تصعيد صلاحيات عبر تعديل الطلب (Mass assignment) | Zod validation + قوائم حقول مسموحة + سياسات `WITH CHECK` |
| T4 | تسريب `service_role` key إلى المتصفح | حظر معماري: العميل الإداري في ملف `server-only` + فحص في CI |
| T5 | تلاعب بالحركات المالية بعد الاعتماد | جداول append-only + منع `UPDATE/DELETE` عبر RLS و Triggers |
| T6 | هجوم تخمين كلمات المرور | Supabase Auth + Rate limiting على مسارات الدخول |
| T7 | تسريب أسرار في Git | `.gitignore` + `.env.example` بلا قيم + فحص أسرار في CI |
| T8 | وصول غير مصرّح لملفات مرفقة | Buckets خاصة + Storage policies مبنية على نفس دوال `app.*` |
| T9 | إنكار الفعل (Repudiation) | `audit_logs` append-only + `created_by/updated_by` |

---

## 2. الدفاع في العمق (Defense in Depth)

```
1. Network / Platform   → HTTPS، HSTS، Security headers
2. Session              → Supabase Auth، كوكيز HttpOnly/Secure/SameSite
3. Server Authorization → فحص الصلاحية قبل تنفيذ أي Use Case
4. Input Validation     → Zod على حدود النظام (Actions / Route Handlers)
5. Database (RLS)       ← ★ خط الدفاع الحقيقي والأخير
6. Audit                → تسجيل من فعل ماذا ومتى
```

**قاعدة حاكمة:** إذا سقطت الطبقات 1–4 بسبب خطأ برمجي، يجب أن تبقى الطبقة 5 كافية لمنع تسرب البيانات.
الواجهة (إخفاء الأزرار) **ليست** طبقة أمان — هي تحسين تجربة فقط.

---

## 3. سياسات RLS

### 3.1 الدوال المساعدة (schema `app`)

تُنفَّذ في Phase 2. كلها `SECURITY DEFINER` + `STABLE` + `SET search_path = ''`:

| الدالة | العائد | الوصف |
|--------|--------|-------|
| `app.current_user_id()` | `uuid` | `auth.uid()` مغلّفة |
| `app.current_org_id()` | `uuid` | منشأة المستخدم الحالي من `profiles` |
| `app.is_active_user()` | `boolean` | حالة الحساب `active` |
| `app.has_permission(p_key text)` | `boolean` | عبر `user_roles → role_permissions → permissions` |
| `app.can_access_branch(p_branch uuid)` | `boolean` | `true` إذا كان الدور بنطاق `organization`، أو الفرع ضمن `user_branches` |

> `SET search_path = ''` إلزامي على كل `SECURITY DEFINER` — بدونه ثغرة تصعيد صلاحيات عبر مخطط مزروع.

### 3.2 قالب السياسات لكل جدول تشغيلي

```sql
alter table public.customers enable row level security;
alter table public.customers force row level security;

create policy customers_select on public.customers
for select to authenticated
using (
  (select app.is_active_user())
  and organization_id = (select app.current_org_id())
  and (select app.can_access_branch(branch_id))
  and (select app.has_permission('customers.view'))
);

create policy customers_insert on public.customers
for insert to authenticated
with check (
  (select app.is_active_user())
  and organization_id = (select app.current_org_id())
  and (select app.can_access_branch(branch_id))
  and (select app.has_permission('customers.create'))
);

create policy customers_update on public.customers
for update to authenticated
using  ( … 'customers.view'   … )
with check ( … 'customers.update' … );   -- ★ يمنع نقل الصف إلى فرع آخر
```

**نقاط حرجة:**
- `WITH CHECK` على `UPDATE` **إلزامي** — بدونه يستطيع المستخدم تغيير `branch_id` وتهريب صف إلى فرع آخر.
- الجداول المالية: **لا سياسة `UPDATE` ولا `DELETE` إطلاقًا** — التصحيح بحركة عكسية.
- `FORCE ROW LEVEL SECURITY` يمنع تجاوز السياسات حتى لمالك الجدول.

### 3.3 اختبارات RLS الإلزامية (Phase 7)

| السيناريو | النتيجة المتوقعة |
|-----------|------------------|
| مستخدم فرع A يقرأ عملاء فرع B | 0 صفوف |
| مستخدم بلا `customers.create` ينشئ عميلًا | فشل السياسة |
| مستخدم يحاول تغيير `branch_id` لصف يملكه | فشل `WITH CHECK` |
| مستخدم يحاول تغيير `organization_id` | فشل `WITH CHECK` |
| مستخدم معطّل (`status != active`) | 0 صفوف على كل الجداول |
| محاولة `UPDATE` على حركة مالية معتمدة | مرفوضة |
| مستخدم بنطاق `organization` يقرأ كل الفروع | ينجح |

هذه الاختبارات تعمل **مباشرة على قاعدة البيانات** بمفتاح `anon` وجلسة مستخدم حقيقية — لا عبر واجهة التطبيق.

---

## 4. إدارة المفاتيح والأسرار

| المفتاح | مكانه | يُسمح باستخدامه في |
|---------|-------|--------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | عام | العميل والخادم |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | عام (محمي بـ RLS) | العميل والخادم |
| `SUPABASE_SERVICE_ROLE_KEY` | **سري** | الخادم فقط، وفي حالات محددة موثّقة |
| مفاتيح مزودي الإشعارات | **سري** | الخادم فقط |

**ضوابط تقنية مُنفَّذة:**
1. `src/infrastructure/supabase/admin.ts` يستورد `server-only` ⇒ أي محاولة استيراده من مكوّن عميل **تفشل عند البناء**.
2. الوصول للبيئة يمر عبر `src/config/env.ts` (Zod) — الأسرار مُعرّفة في مخطط الخادم فقط.
3. `.env*` مستثناة من Git، و`.env.example` بلا قيم حقيقية.
4. CI يفحص التسريب قبل الدمج.

**متى يُسمح بـ `service_role`؟** فقط في: seeding، مهام إدارية موثّقة، Webhooks موقّعة، ومهام خلفية. وفي كل حالة يجب أن يسبقه فحص صلاحية صريح في الكود.

---

## 5. التحقق من المدخلات

- كل Server Action و Route Handler يبدأ بـ **Zod schema** — لا استثناءات.
- النمط الإلزامي في كل نقطة دخول:
  ```
  1) getUser()               → 401 إن لم يوجد
  2) requirePermission(key)  → 403 إن لم تتوفر
  3) schema.parse(input)     → 422 عند الفشل
  4) useCase(...)            → منطق العمل
  5) auditLog(...)           → للعمليات المؤثرة
  ```
- رسائل الأخطاء للمستخدم عامة؛ التفاصيل التقنية تذهب للسجلات فقط (لا تسريب بنية داخلية).

---

## 6. ضوابط أخرى

| الضابط | الحالة |
|--------|--------|
| Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) | ✅ Phase 1 — `next.config.ts` |
| `poweredByHeader: false` | ✅ Phase 1 |
| HTTPS/HSTS | تُدار من Vercel |
| Rate limiting على الدخول والعمليات الحساسة | ⬜ Phase 2 |
| Storage: Buckets خاصة + سياسات | ⬜ عند تفعيل الملفات |
| مراجعة أمنية قبل كل إصدار | إلزامية |

## 7. الخصوصية

- لا نُخزّن بيانات طبية أو حساسة لم يطلبها العميل صراحة.
- سجل التدقيق يخزّن **مراجع** لا نسخًا كاملة من البيانات الحساسة.
- تصدير التقارير يخضع لنفس فحص الصلاحية والفرع الذي يخضع له العرض.

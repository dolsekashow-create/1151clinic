# DATABASE — التصميم المنطقي وقاعدة البيانات

> **الحالة:** **42 جدولًا مُنفَّذة** في `supabase/migrations/` مع سياسات RLS كاملة،
> ومُختبَرة على محرّك PostgreSQL حقيقي (`pnpm test:rls`).
>
> ⚠️ **الترحيلات لم تُطبَّق بعد على مشروع Supabase الحقيقي** — تُطبَّق عبر
> `supabase db push` بعد ربط المشروع (راجع [DEPLOYMENT.md](./DEPLOYMENT.md) §6).

## 0. الترحيلات المُنفَّذة

| الملف | المحتوى |
|-------|---------|
| `20260816000000_init_foundation.sql` | المخططات، الامتدادات، دوال البنية المشتركة |
| `20260817001000_identity_rbac.sql` | التنظيم، المستخدمون، RBAC، **دوال الأمان ومولّد السياسات** |
| `20260817002000_core_entities.sql` | العملاء، الخدمات، الحجوزات |
| `20260817003000_inventory.sql` | المخازن، الأصناف، الموردون، دفتر الحركات، الأرصدة |
| `20260817004000_purchasing.sql` | الطلبات، أوامر الشراء، الاستلام، الموافقات |
| `20260817005000_finance.sql` | الخزائن، الحركات والقيود، الورديات، العهدة، المصروفات، المدفوعات |
| `20260817006000_notifications_files_audit.sql` | الإشعارات، الملفات، سجل التدقيق، طبقة التكامل |

**التوليد الآلي (مصدر حقيقة واحد):**

| المُخرَج | المصدر | الأمر |
|----------|--------|-------|
| `supabase/seed/01_permissions_roles.sql` | `packages/core/src/permissions/catalog.ts` | `pnpm db:seed:generate` |
| `packages/types/src/database.types.ts` | `supabase/migrations/*.sql` | `pnpm db:types:generate` |

> كلاهما مُولَّد لأن النسخ اليدوي يُنتج تفرّعًا صامتًا — وهو بالضبط نوع الخطأ
> الذي يُحدث ثغرة صلاحيات أو انهيار أنواع.

---

## 1. المبادئ والاصطلاحات (Conventions)

| القاعدة | القرار | السبب |
|---------|--------|-------|
| المفتاح الأساسي | `uuid` مع `gen_random_uuid()` | الكيانات تُنشأ من عدة فروع ومن استيراد النظام القديم؛ التسلسل الرقمي يسبب تعارضًا ويكشف حجم البيانات. |
| الأرقام المرجعية للمستخدم | عمود منفصل `code` / `reference_no` بتسلسل لكل فرع | UUID غير صالح للعرض البشري — الموظف يحتاج «أمر شراء رقم 1042». |
| المبالغ المالية | `numeric(18,4)` | **ممنوع** `float`/`double` في أي قيمة مالية — أخطاء تقريب. |
| العملة | `char(3)` (ISO-4217) على كل حركة | تعدد العملات مستقبلًا بلا ترحيل مؤلم. |
| التواريخ | `timestamptz` دائمًا (UTC) | الفروع قد تختلف مناطقها الزمنية؛ التحويل في العرض. |
| الحذف | Soft delete (`deleted_at`) للكيانات المرجعية، Hard delete ممنوع على الحركات المالية | السجل المالي غير قابل للحذف — يُعكس بقيد مضاد. |
| التدقيق | `created_at, updated_at, created_by, updated_by` على كل جدول تشغيلي | مطلب Enterprise. |
| النطاق | `organization_id` إلزامي، `branch_id` حيثما ينطبق | أساس عزل RLS. |
| التسمية | `snake_case`، أسماء الجداول جمع | اصطلاح PostgreSQL السائد. |
| الحالات (Status) | `enum` في PostgreSQL عند ثبات القيم، وجدول مرجعي عند احتمال التغيير | الحالات غير المعتمدة تُترك كجدول مرجعي لسهولة التعديل. |

### مخططات (Schemas)

| Schema | المحتوى |
|--------|---------|
| `public` | جداول التطبيق (مكشوفة عبر PostgREST) |
| `app` | دوال الأمان والمساعدة (`SECURITY DEFINER`) — **غير مكشوفة للعميل** |
| `audit` | سجلات التدقيق |
| `integration` | جداول الاستيراد/المزامنة مع النظام القديم (staging) |

---

## 2. المخطط المنطقي (ERD)

### 2.1 الهوية والتنظيم — Phase 2/3

```
organizations
    │ 1
    ├──────< branches            (فرع ينتمي لمنشأة)
    │            │ 1
    │            └──────< departments
    │
    ├──────< profiles            (مستخدم ينتمي لمنشأة)  [id = auth.users.id]
    │            │
    │            ├──────< user_roles ──────> roles ──────< role_permissions ──────> permissions
    │            │
    │            └──────< user_branches ────> branches     (وصول المستخدم للفروع)
    │
    └──────< audit_logs
```

| الجدول | أعمدة أساسية | ملاحظات |
|--------|--------------|---------|
| `organizations` | `id, name_ar, name_en, code, status, settings jsonb` | المنشأة الأم. `settings` وعاء للإعدادات القابلة للتهيئة. |
| `branches` | `id, organization_id, code UNIQUE(org,code), name_ar, phone, address, timezone, status` | الفرع. |
| `departments` | `id, organization_id, branch_id?, name_ar, parent_id?` | القسم — قد يكون على مستوى المنشأة أو الفرع. `parent_id` يدعم تشجيرًا. |
| `profiles` | `id (FK auth.users), organization_id, full_name_ar, phone, employee_code, status, default_branch_id` | **لا يحتوي كلمة مرور.** |
| `roles` | `id, organization_id?, key, name_ar, is_system` | `organization_id = null` ⇒ دور نظامي عام. `is_system` يمنع الحذف. |
| `permissions` | `id, key UNIQUE, module, action, name_ar` | مرجع عام للنظام كله. |
| `role_permissions` | `role_id, permission_id` (PK مركّب) | |
| `user_roles` | `user_id, role_id, scope('organization'\|'branch'), branch_id?` | نطاق الدور. |
| `user_branches` | `user_id, branch_id, is_default` (PK مركّب) | الفروع التي يصلها المستخدم. |

**فهارس حرجة:** `user_branches(user_id)`، `user_roles(user_id)`، `role_permissions(role_id)` — تُستدعى في كل سياسة RLS.

### 2.2 العملاء والخدمات والحجوزات — Phase 3/4

```
customers ──< appointments >── services
                   │
                   ├──> branches
                   └──> profiles (staff/doctor)
```

| الجدول | أعمدة أساسية | ملاحظات |
|--------|--------------|---------|
| `customers` | `organization_id, branch_id, code, full_name_ar, phone, email, status, notes` | **لا بيانات طبية أو حساسة** — لم تُطلب. `UNIQUE(organization_id, phone)` قابل للمراجعة. |
| `services` | `organization_id, code, name_ar, description, status` | التسعير/الخصومات/الباقات/العمولات: `BUSINESS_RULE_PENDING` — جدول `service_pricing` منفصل لاحقًا حتى لا يتغير هذا الجدول. |
| `branch_services` | `branch_id, service_id, is_available` | توفر الخدمة بالفرع. |
| `appointments` | `organization_id, branch_id, customer_id, service_id, staff_id, scheduled_at, duration_minutes, status_id, notes` | الحالات و الـ Workflow: `BUSINESS_RULE_PENDING` ⇒ `appointment_statuses` **جدول مرجعي** لا `enum`. |

### 2.3 المخازن — Phase 4

```
warehouses ──< stock_levels >── items ──> item_categories
     │                            │
     └──< stock_movements ────────┘──> units
              │
              └──> suppliers (عند الاستلام)
```

| الجدول | ملاحظات |
|--------|---------|
| `item_categories`, `units` | مراجع بسيطة. |
| `items` | `organization_id, code, name_ar, category_id, base_unit_id, tracking('none'\|'batch'\|'serial')` — نوع التتبع يُترك عمودًا لأن دورة المخزن `BUSINESS_RULE_PENDING`. |
| `warehouses` | `organization_id, branch_id, code, name_ar` — المخزن تابع لفرع. |
| `stock_levels` | `warehouse_id, item_id, quantity numeric(18,4)` — PK مركّب. **مشتق**: يُحدَّث فقط من `stock_movements` (لا كتابة مباشرة). |
| `stock_movements` | `type('receipt'\|'issue'\|'transfer_in'\|'transfer_out'\|'adjustment')`, `quantity`, `unit_cost`, `reference_module`, `reference_id`, `occurred_at`, `created_by` | **دفتر أستاذ للمخزون: append-only.** التصحيح بحركة عكسية لا بتعديل. |

> `stock_levels` كجدول مشتق قرار متعمد: القراءة السريعة مطلوبة في 15 فرعًا، والحقيقة تبقى في `stock_movements` القابل لإعادة الحساب.

### 2.4 المشتريات — Phase 4

```
suppliers ──< purchase_orders ──< purchase_order_items
                   │
                   └──< goods_receipts ──< goods_receipt_items ──> stock_movements
purchase_requests ──< purchase_request_items          (خطوة اختيارية)
approvals (polymorphic) ──> أي مستند
```

- `approvals`: `entity_type, entity_id, step_no, approver_id, status, decided_at, note`.
  **مفصولة عمدًا** لأن سلسلة الموافقات `BUSINESS_RULE_PENDING` — تغيير عدد الخطوات لا يمس جداول المشتريات.

### 2.5 المالية والخزائن والورديات — Phase 4

```
treasuries ──< treasury_movements
     │                │
     │                └──> financial_transactions ──< financial_entries
     │
shifts ──< shift_transactions
     └──> custody_handovers
suppliers ──< supplier_payments
expense_categories ──< expenses
```

| الجدول | أعمدة أساسية | ملاحظات |
|--------|--------------|---------|
| `treasuries` | `organization_id, branch_id, code, name_ar, currency, status` | الخزينة تابعة لفرع. |
| `financial_transactions` | `organization_id, branch_id, reference_no, type, amount, currency, occurred_at, status, source_module, source_record_id, description, created_by` | **الرأس**: الحدث المالي. `source_module/source_record_id` هما رابط «العملية التي سبّبت الحركة». |
| `financial_entries` | `transaction_id, direction('debit'\|'credit'), account_ref, amount, currency` | **التفاصيل**: بنية القيد. `account_ref` نصّي مرن الآن — لا نبني دليل حسابات كامل قبل اعتماده. طريقة القيد: `BUSINESS_RULE_PENDING`. |
| `treasury_movements` | `treasury_id, transaction_id?, direction('in'\|'out'), amount, currency, occurred_at, status, description` | حركة النقد الفعلية. |
| `shifts` | `organization_id, branch_id, treasury_id, opened_by, opened_at, closed_by?, closed_at?, opening_balance, closing_balance?, expected_balance?, difference?, status` | حساب التقفيل: `BUSINESS_RULE_PENDING` — الأعمدة موجودة، **المعادلة غير مُنفّذة**. |
| `custody_handovers` | `shift_id?, from_user_id, to_user_id, amount, currency, handed_at, status, note` | تسليم العهدة. |
| `suppliers` | `organization_id, code, name_ar, phone, email, status` | |
| `supplier_payments` | `supplier_id, transaction_id, amount, currency, paid_at, method` | |
| `expense_categories`, `expenses` | `expenses(branch_id, category_id, transaction_id, amount, occurred_at)` | |

**قيود سلامة إلزامية:**
- `amount > 0` على كل حركة (الاتجاه يُحدده `direction`، لا الإشارة السالبة).
- `financial_transactions` و `treasury_movements` و `stock_movements`: **لا `UPDATE` ولا `DELETE`** بعد الاعتماد — يُفرض بـ RLS + Trigger.
- `UNIQUE(organization_id, reference_no)` على المستندات المرقّمة.

### 2.6 الإشعارات — Phase 5

| الجدول | ملاحظات |
|--------|---------|
| `notification_templates` | `key, channel('sms'\|'email'\|'push'\|'whatsapp'), locale, subject?, body, variables jsonb` |
| `notifications` | `organization_id, branch_id, channel, template_key, recipient, payload jsonb, status('queued'\|'sending'\|'sent'\|'failed'\|'cancelled'), attempts, last_error, provider, provider_message_id, scheduled_at, sent_at` |
| `notification_logs` | كل محاولة إرسال ونتيجتها — لتتبع التسليم وإعادة المحاولة. |

> **ممنوع** تخزين مفاتيح المزود في قاعدة البيانات — تبقى في متغيرات البيئة.

### 2.7 التدقيق — Phase 6

`audit.audit_logs`: `id, organization_id, branch_id, user_id, action, module, entity_type, entity_id, old_values jsonb, new_values jsonb, ip_address inet, user_agent, created_at`.

- append-only، لا يملك أحد صلاحية `UPDATE`/`DELETE` عليه.
- **ممنوع** تسجيل كلمات المرور أو التوكنات أو الأسرار — قائمة حقول محظورة تُنقّى قبل الكتابة.

### 2.8 التكامل مع النظام القديم — لاحقًا

مخطط `integration` منفصل:
- `integration.import_batches` — دفعة استيراد (المصدر، الوقت، الحالة، الإحصاءات).
- `integration.entity_mappings` — `(entity_type, legacy_id, new_id)` لمنع التكرار وجعل الاستيراد **idempotent**.
- `integration.sync_logs`.

> لا يوجد أي كود تكامل الآن — النظام القديم غير معروف. الوجود هنا هو **حجز معماري** فقط.

---

## 3. الأمان على مستوى قاعدة البيانات (RLS)

كل جدول في `public` عليه `ENABLE ROW LEVEL SECURITY`، ولا يوجد جدول بلا سياسة —
ويوجد **اختبار يفشل تلقائيًا** إن أُضيف جدول جديد بلا حماية.

السياسات القياسية تُولَّد من `app.apply_rls()`، والاستثناءات مكتوبة يدويًا.
راجع [SECURITY.md](./SECURITY.md) §3 للقالب ودوال `app.*` وقرار عدم استخدام `FORCE RLS`.

### 3.1 الاختلافات عن التصميم الأصلي (وسببها)

| البند | التصميم الأولي | ما نُفِّذ | السبب |
|-------|----------------|-----------|-------|
| جدول `doctors` | جدول منفصل | `profiles.is_service_provider` | تجنّب ازدواج هوية المستخدم ومزامنتها (AD-06) |
| `audit_logs` | مخطط `audit` | `public.audit_logs` | PostgREST يكشف `public` فقط؛ الوحدة تحتاج قراءته من الواجهة |
| `FORCE ROW LEVEL SECURITY` | مُفعَّل | غير مُفعَّل | يُخضع دوال `SECURITY DEFINER` للسياسات فيعيد مشكلة التكرار — راجع SECURITY §3.1 |
| `branch_services` | جدول ربط بسيط | كما هو + سياسات يدوية | لا يحمل `organization_id` فنطاقه يُشتق من الفرع |

## 4. الترحيلات (Migrations)

- المصدر الوحيد للحقيقة: `supabase/migrations/*.sql` مرقّمة زمنيًا.
- **ممنوع** تعديل ملف ترحيل مُطبَّق على staging/production — يُضاف ملف جديد.
- كل ملف يبدأ بتعليق: الغرض، الـ Phase، والمرجع في هذا المستند.
- `supabase/seed/` للبيانات المرجعية فقط (permissions، roles) — **لا بيانات عملاء أو مالية.**

## 5. اختبار قاعدة البيانات

```bash
pnpm test:rls
```

يشغّل PostgreSQL حقيقيًا مضمّنًا في `node_modules` (بلا Docker وبلا Supabase CLI)،
يطبّق **نفس** ملفات الترحيل والبذور، ثم ينفّذ 38 اختبارًا بدور `authenticated`.

⚠️ الترميز مضبوط على UTF-8 صراحةً في منصة الاختبار: `initdb` على Windows يختار
WIN1252 من إعدادات النظام فتفشل كل الأسماء العربية.

ما تُحاكيه المنصة من Supabase: الأدوار `anon`/`authenticated`/`service_role`،
مخطط `auth`، و`auth.uid()` بنفس تعريف Supabase.
ما لا تُحاكيه: GoTrue و PostgREST و Storage — خارج نطاق اختبار RLS.

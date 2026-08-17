# DATABASE_REVIEW — مراجعة قاعدة البيانات والمعمارية قبل أول ترحيل حقيقي

**التاريخ:** 2026-08-17 · **النطاق:** 45 جدولًا · 8 ملفات ترحيل · 126 سياسة RLS
**الأساس:** استقصاء آلي للمخطط الفعلي من محرّك PostgreSQL (`scripts/introspect-schema.mjs`)، لا قراءة ملفات SQL.
**الحالة:** لم تُطبَّق أي ترحيلات على مشروع Supabase الحقيقي.

> **أهم نتيجة:** المراجعة كشفت ثغرة **CRITICAL** مُثبَتة عمليًا كانت تُسقط عزل الفروع بالكامل.
> أُصلحت وأُضيف اختبار انحدار. لو طُبِّقت الترحيلات قبل هذه المراجعة لكانت الثغرة في الإنتاج.

| # | القسم |
|---|-------|
| 1 | [ملخّص المخطط](#1-ملخّص-المخطط) |
| 2 | [مراجعة العلاقات](#2-مراجعة-العلاقات) |
| 3 | [مراجعة RLS](#3-مراجعة-rls) |
| 4 | [النتائج الأمنية](#4-النتائج-الأمنية) |
| 5 | [نتائج الأداء](#5-نتائج-الأداء) |
| 6 | [مراجعة الترحيلات](#6-مراجعة-الترحيلات) |
| 7 | [التعديلات الموصى بها](#7-التعديلات-الموصى-بها) |
| 8 | [قرارات عالية المخاطر](#8-قرارات-عالية-المخاطر) |
| 9 | [قواعد العمل المعلّقة](#9-قواعد-العمل-المعلّقة) |
| 10 | [التوصية النهائية](#10-التوصية-النهائية) |

---

## 1. ملخّص المخطط

### 1.1 أرقام

| المؤشر | العدد |
|--------|-------|
| الجداول | 45 (42 في `public` + 3 في `integration`) |
| الأعمدة | 588 |
| المفاتيح الأجنبية | 137 |
| الفهارس | 181 (بعد الإصلاح؛ كانت 138) |
| سياسات RLS | 126 على 42 جدولًا |
| المحفّزات | 40 |
| قيود CHECK | 61 · قيود UNIQUE | 31 · مفاتيح أساسية | 45 |
| جداول بحذف ناعم | 10 |

### 1.2 الاصطلاحات — تحقّق فعلي

| القاعدة | النتيجة |
|---------|---------|
| لا `float` / `double` / `money` في أي عمود | ✅ **صفر** |
| كل المبالغ والكميات `numeric` | ✅ 21 عمودًا |
| كل التواريخ `timestamptz` | ✅ لا يوجد `timestamp without time zone` |
| المفاتيح الأساسية `uuid` | ✅ عدا `audit_logs.id` (`bigint identity` — متعمّد: سجل تسلسلي ضخم) |
| `organization_id` على كل جدول تشغيلي | ✅ (عدا جداول الربط التي تشتق نطاقها من الأب) |
| `created_at` / `updated_at` / `created_by` / `updated_by` | ✅ على كل جدول تشغيلي |

### 1.3 جدول الجداول

نطاق: **O** = `organization_id` · **B** = `branch_id` (`B?` = قابل للإفراغ ⇒ سجل مشترك) · **SD** = حذف ناعم

#### الهوية والتنظيم

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `organizations` | المنشأة | uuid | — | — | — | ✅ | `unique(code)` · `status ∈ {active,inactive}` |
| `branches` | الفرع | uuid | `organization_id` | ✅ | *ذاته* | ✅ | `unique(org, code)` |
| `departments` | القسم/الإدارة | uuid | `organization_id`, `branch_id`, `parent_id` (ذاتي) | ✅ | B? | ✅ | `unique(org, code)` |
| `profiles` | المستخدم (بلا كلمة مرور) | uuid = `auth.users.id` | `organization_id`, `department_id`, `default_branch_id` | ✅ | عبر `default_branch_id` | ✅ | `unique(org, employee_code)` · `status ∈ {active,inactive,suspended}` |
| `permissions` | كتالوج الصلاحيات | uuid | — | — | — | — | `unique(key)` · `key ~ '^[a-z]+\.[a-z.]+$'` |
| `roles` | الأدوار | uuid | `organization_id` (nullable = دور نظامي) | جزئي | — | — | فهرس فريد على `coalesce(org, uuid-صفري), key` |
| `role_permissions` | ربط | (role, permission) | كلاهما | — | — | — | PK مركّب |
| `user_roles` | إسناد الأدوار | uuid | `user_id`, `role_id` | — | — | — | `unique(user, role, scope)` · `scope ∈ {organization,branch}` |
| `user_branches` | وصول الفروع | (user, branch) | كلاهما | — | ✅ | — | PK مركّب |

#### العملاء والخدمات والحجوزات

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `customers` | العملاء | uuid | `organization_id`, `branch_id` | ✅ | ✅ | ✅ | فهرس فريد جزئي `(org, phone) where deleted_at is null` · `(org, code)` |
| `services` | الخدمات | uuid | `organization_id`, `branch_id` | ✅ | B? | ✅ | `unique(org, code)` · **لا أعمدة سعر** (P-14) |
| `branch_services` | توفر الخدمة بالفرع | (branch, service) | كلاهما | — | ✅ | — | PK مركّب |
| `appointment_statuses` | حالات الحجز (مرجعي) | uuid | `organization_id` | ✅ | — | — | `unique(org, key)` · `category ∈ {open,done,cancelled}` |
| `appointments` | الحجوزات | uuid | `customer_id`, `service_id`, `provider_id`, `status_id` | ✅ | ✅ | ✅ | `unique(org, reference_no)` · `duration_minutes > 0` |

#### المخازن

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `item_categories` | تصنيفات | uuid | `organization_id`, `parent_id` (ذاتي) | ✅ | B? | — | `unique(org, code)` |
| `units` | وحدات القياس | uuid | `organization_id` | ✅ | B? | — | `unique(org, code)` |
| `items` | الأصناف | uuid | `category_id`, `base_unit_id` | ✅ | B? | ✅ | `tracking ∈ {none,batch,serial}` · `reorder_level ≥ 0` |
| `warehouses` | المخازن | uuid | `organization_id`, `branch_id` | ✅ | ✅ | — | `unique(org, code)` · `unique(id, branch_id)` (للمفتاح المركّب) |
| `suppliers` | الموردون | uuid | `organization_id` | ✅ | B? | ✅ | `unique(org, code)` |
| `stock_movements` | **دفتر** حركات المخزون | uuid | `warehouse_id`, `item_id`, `unit_id` | ✅ | ✅ | — | `quantity > 0` · `direction ∈ {1,-1}` · **append-only** |
| `stock_levels` | رصيد **مشتق** | (warehouse, item) | `(warehouse_id, branch_id)` مركّب | ✅ | ✅ | — | يُكتب من محفّز فقط · قابل لإعادة الحساب |

#### المشتريات

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `purchase_requests` | طلب شراء | uuid | `department_id`, `requested_by` | ✅ | ✅ | — | `unique(org, reference_no)` · `unique(id, branch_id)` |
| `purchase_request_items` | بنود الطلب | uuid | `(purchase_request_id, branch_id)` مركّب | ✅ | ✅ | — | `quantity > 0` |
| `purchase_orders` | أمر شراء | uuid | `supplier_id`, `purchase_request_id` (اختياري — P-09) | ✅ | ✅ | — | `total_amount ≥ 0` محسوب بمحفّز |
| `purchase_order_items` | بنود الأمر | uuid | `(purchase_order_id, branch_id)` مركّب | ✅ | ✅ | — | `line_total` عمود مولّد مخزّن |
| `goods_receipts` | استلام | uuid | `purchase_order_id`, `supplier_id`, `warehouse_id` | ✅ | ✅ | — | `unique(org, reference_no)` |
| `goods_receipt_items` | بنود الاستلام | uuid | `(goods_receipt_id, branch_id)` مركّب, `purchase_order_item_id` | ✅ | ✅ | — | منفصلة عن بنود الأمر ⇒ استلام جزئي ممكن (P-10) |
| `approvals` | موافقات عامة (polymorphic) | uuid | `approver_id` | ✅ | B? | — | `unique(entity_type, entity_id, step_no)` · `step_no > 0` |

#### المالية

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `treasuries` | الخزائن | uuid | `organization_id`, `branch_id` | ✅ | ✅ | — | `type ∈ {cash,bank,other}` |
| `financial_transactions` | رأس الحركة المالية | uuid | `organization_id`, `branch_id` | ✅ | ✅ | — | `amount > 0` · `status ∈ {draft,posted,void}` · `unique(org, idempotency_key)` · محفّز يمنع تعديل المُرحَّل |
| `financial_entries` | بنود القيد | uuid | `(transaction_id, branch_id)` مركّب | ✅ | ✅ | — | `direction ∈ {debit,credit}` · `amount > 0` · **لا توازن مفروض** (P-02) |
| `treasury_movements` | **دفتر** حركة النقد | uuid | `treasury_id`, `transaction_id`, `shift_id` | ✅ | ✅ | — | `direction ∈ {1,-1}` · **append-only** |
| `shifts` | الورديات | uuid | `treasury_id`, `opened_by`, `closed_by` | ✅ | ✅ | — | فهرس فريد جزئي: وردية مفتوحة واحدة لكل (مستخدم، خزينة) · `expected_balance`/`difference` تبقى NULL (P-01) |
| `custody_handovers` | العهدة | uuid | `shift_id`, `treasury_id`, `from_user_id`, `to_user_id` | ✅ | ✅ | — | `amount > 0` · `from ≠ to` |
| `expense_categories` | تصنيفات المصروفات | uuid | `organization_id` | ✅ | B? | — | `unique(org, code)` |
| `expenses` | المصروفات | uuid | `category_id`, `transaction_id`, `treasury_id` | ✅ | ✅ | — | `amount > 0` |
| `supplier_payments` | مدفوعات الموردين | uuid | `supplier_id`, `transaction_id`, `treasury_id`, `purchase_order_id` | ✅ | ✅ | — | `method ∈ {cash,bank_transfer,card,cheque,other}` |

#### النظام

| الجدول | الغرض | PK | مفاتيح أجنبية رئيسية | O | B | SD | قيود بارزة |
|--------|-------|----|--------------------|---|---|----|-----------|
| `notification_templates` | قوالب الرسائل | uuid | `organization_id` | ✅ | B? | — | `unique(org, key, channel, locale)` |
| `notifications` | الإشعارات | uuid | `recipient_user_id`, `recipient_customer_id` | ✅ | B? | — | `status ∈ {queued,…,cancelled}` · `attempts ≥ 0` |
| `notification_logs` | محاولات الإرسال | uuid | `notification_id` | ✅ | B? | — | `attempt_no > 0` |
| `files` | بيانات وصفية للملفات | uuid | `organization_id` | ✅ | B? | ✅ | `unique(bucket, storage_path)` · `is_public` افتراضيًا false |
| `audit_logs` | **دفتر** التدقيق | bigint identity | `organization_id`, `branch_id`, `user_id` | ✅ | B? | — | **append-only** |
| `integration.import_batches` | دفعات الاستيراد | uuid | `organization_id` | ✅ | — | — | غير مكشوف عبر PostgREST |
| `integration.entity_mappings` | جسر المعرّفات القديمة | uuid | `batch_id` | ✅ | — | — | `unique(source_system, entity_type, legacy_id)` ⇒ استيراد idempotent |
| `integration.sync_logs` | سجل المزامنة | bigint identity | `organization_id` | ✅ | — | — | — |

### 1.4 جداول أو علاقات أراها غير مناسبة

| الجدول/العلاقة | الحكم | التفصيل |
|----------------|-------|---------|
| `stock_movements.updated_at` / `updated_by` | **زائدة** | الجدول append-only؛ العمودان لن يتغيرا أبدًا. LOW-03 |
| `branch_services` بلا `updated_at` | **ناقصة** | له سياسة UPDATE بلا أثر زمني. LOW-04 |
| `treasury_movements.shift_id` | **سليمة لكن غير مُلزِمة** | لا شيء يفرض أن حركة النقد تنتمي لوردية مفتوحة — قرار صحيح لأن قاعدة الوردية معلّقة (P-01) |
| `approvals` polymorphic بلا FK | **مقبولة بوعي** | `entity_type`/`entity_id` بلا تكامل مرجعي — الثمن المقبول لدعم أي مستند. يجب فرض التكامل في طبقة التطبيق |
| `roles` بمعرّف منشأة قابل للإفراغ | **سليمة** | الفهرس الفريد بـ`coalesce` يعالج NULL بشكل صحيح |
| `audit_logs.id` من نوع `bigint` | **سليمة ومقصودة** | سجل عالي الحجم؛ UUID عشوائي يفسد محلية الكتابة في B-tree |

---

## 2. مراجعة العلاقات

### 2.1 التنظيم والهوية

```
organizations ─┬─< branches ──< departments ──┐
               │        │                     │
               │        └──< warehouses       │
               │        └──< treasuries       │
               │                              │
               ├─< profiles ──────────────────┘ (department_id)
               │      ├──< user_roles ──> roles ──< role_permissions ──> permissions
               │      └──< user_branches ──> branches
               └─< roles (organization_id nullable ⇒ دور نظامي)
```

✅ **سليم.** المسار من المستخدم إلى الصلاحية ثلاث قفزات مفهرسة بالكامل.
`profiles.default_branch_id` مرجع تفضيل عرض فقط — الوصول الفعلي من `user_branches` حصرًا، وهذا فصل صحيح.

### 2.2 العملاء والحجوزات

```
customers ──< appointments >── services ──< branch_services >── branches
                  │
                  ├──> profiles (provider_id ← is_service_provider)
                  └──> appointment_statuses (جدول مرجعي لا enum)
```

✅ **سليم.** مقدّم الخدمة = `profiles` بعلامة، لا جدول `doctors` منفصل ⇒ لا ازدواج هوية ولا مزامنة.
`service_id` قابل للإفراغ ⇒ حجز بلا خدمة محددة ممكن (لم تُحسم قاعدته — P-11).

### 2.3 المخازن

```
warehouses ──< stock_movements >── items ──> item_categories
     │  └──────< stock_levels >──────┘   └──> units
     └──> branches
```

✅ **سليم بعد الإصلاح.** `stock_levels` صار مرتبطًا بـ`(warehouse_id, branch_id)` مركّبًا ⇒ يستحيل رصيد في فرع مخالف لفرع مخزنه.
`stock_levels` **مشتق بالكامل** من `stock_movements` وقابل لإعادة البناء عبر `app.recalculate_stock_levels()`.

### 2.4 المشتريات

```
suppliers ──< purchase_orders ──< purchase_order_items
                 │    ▲                    ▲
                 │    │ (اختياري)          │ (اختياري)
                 │  purchase_requests ──< purchase_request_items
                 │
                 └──< goods_receipts ──< goods_receipt_items
approvals (polymorphic) ┈┈> أي مستند
```

✅ **سليم.** الروابط بين الطلب والأمر والاستلام **اختيارية** عمدًا (P-09، P-10) ⇒ أي دورة تُعتمد لاحقًا تعمل بلا ترحيل بنيوي.

### 2.5 المالية

```
treasuries ──< treasury_movements >── financial_transactions ──< financial_entries
     │               │                        ▲   ▲   ▲
     │               └──> shifts              │   │   └── expenses ──> expense_categories
     │                      └──< custody_handovers  └────── supplier_payments ──> suppliers
     └──> branches
```

✅ **سليم.** `financial_transactions` هو نقطة الالتقاء الوحيدة لكل الأحداث المالية، وحقلا `source_module`/`source_record_id` هما جسر الربط التشغيلي↔المالي.

### 2.6 الاعتماد الدائري (Circular Dependency)

**تحقّق آلي على 137 مفتاحًا أجنبيًا:**

| النوع | النتيجة |
|-------|---------|
| دورة بين جداول مختلفة | ❌ **لا توجد** |
| مراجع ذاتية | 2 فقط: `departments.parent_id`، `item_categories.parent_id` |
| ترتيب إدراج قابل للتحقيق من قاعدة فارغة | ✅ مُثبَت — كل تشغيل اختبار يبني القاعدة من الصفر |

⚠️ المراجع الذاتية بلا حماية من الحلقات (A→B→A). لا يمنعها المحرّك. **MEDIUM-05**.

---

## 3. مراجعة RLS

### 3.1 مصفوفة السياسات (42 جدولًا · 126 سياسة)

**النطاق:** `O` = المنشأة · `B` = الفرع · `B+` = الفرع + السجلات المشتركة للقراءة · `SELF` = المستخدم نفسه · `—` = بلا سياسة (ممنوع)

| الجدول | SELECT | INSERT | UPDATE | DELETE | WITH CHECK | النطاق |
|--------|--------|--------|--------|--------|-----------|--------|
| `organizations` | `organizations.organization.view` | — | `…update` | — | ✅ | O |
| `branches` | `organizations.branches.view` | `…create` + نطاق منشأة | `…update` | — | ✅ | O+B |
| `departments` | `…departments.view` | `…manage` | `…manage` | — | ✅ | O+B+ |
| `profiles` | `identity.users.view` أو SELF | — | `identity.users.update` أو SELF | — | ✅ | O+SELF |
| `permissions` | أي مستخدم نشط | — | — | — | — | عام |
| `roles` | `identity.roles.view` | `…manage` (غير نظامي) | `…manage` (غير نظامي) | `…manage` (غير نظامي) | ✅ | O |
| `role_permissions` | `identity.roles.view` | `…manage` | — | `…manage` | ✅ | O عبر الأب |
| `user_roles` | `identity.users.view` أو SELF | `…roles.manage` + `user ≠ self` | — | `…roles.manage` + `user ≠ self` | ✅ | O |
| `user_branches` | `identity.users.view` أو SELF | `identity.branches.assign` + `user ≠ self` + نطاق الفرع | — | نفسه | ✅ | O+B |
| `customers` | `customers.view` | `customers.create` | `customers.update` | `customers.delete` | ✅ | O+B |
| `services` | `services.view` | `services.create` | `services.update` | — | ✅ | O+B+ |
| `branch_services` | `services.view` | `services.update` | `services.update` | `services.update` | ✅ | B |
| `appointment_statuses` | `appointments.view` | `settings.update` (ALL) | ↑ | ↑ | ✅ | O |
| `appointments` | `appointments.view` | `appointments.create` | `appointments.update` | — | ✅ | O+B |
| `item_categories` · `units` · `items` | `inventory.view` | `inventory.create` | `inventory.update` | — | ✅ | O+B+ |
| `warehouses` | `inventory.view` | `inventory.warehouses.manage` | ↑ | — | ✅ | O+B |
| `suppliers` | `purchasing.suppliers.view` | `…manage` | `…manage` | — | ✅ | O+B+ |
| `stock_movements` | `inventory.view` | `inventory.create` | **—** | **—** | ✅ | O+B · **دفتر** |
| `stock_levels` | `inventory.view` | — | — | — | — | O+B · مشتق |
| `purchase_requests` · `purchase_orders` · `goods_receipts` | `purchasing.view` | `purchasing.create`/`receive` | ↑ | — | ✅ | O+B |
| بنود المشتريات (3 جداول) | `purchasing.view` | ↑ | ↑ | ↑ | ✅ | O+B |
| `approvals` | `purchasing.view` | `purchasing.approve` | `purchasing.approve` | — | ✅ | O+B+ |
| `treasuries` | `finance.treasury.view` | `finance.treasury.manage` | ↑ | — | ✅ | O+B |
| `financial_transactions` | `finance.view` | `finance.create` | `finance.approve` ⚠️ + محفّز | — | ✅ | O+B |
| `financial_entries` | `finance.view` | `finance.create` | `finance.approve` | — | ✅ | O+B |
| `treasury_movements` | `finance.treasury.view` | `finance.create` | **—** | **—** | ✅ | O+B · **دفتر** |
| `shifts` | `finance.view` | `finance.shifts.open` | `finance.shifts.close` | — | ✅ | O+B |
| `custody_handovers` | `finance.view` | `finance.custody.handover` | ↑ | — | ✅ | O+B |
| `expenses` · `supplier_payments` · `expense_categories` | `finance.view` | `finance.create`/`treasury.manage` | `finance.approve` | — | ✅ | O+B(+) |
| `notification_templates` | `notifications.view` | `…templates.manage` | ↑ | ↑ | ✅ | O+B+ |
| `notifications` | `notifications.view` أو مستلمها | `notifications.send` | `notifications.send` أو مستلمها ⚠️ | — | ✅ | O+B |
| `notification_logs` | `notifications.view` | — | — | — | — | O |
| `files` | `reports.view` | `reports.view` | — | — | ✅ | O+B+ |
| `audit_logs` | `audit.view` | `user_id = self` ⚠️ | **—** | **—** | ✅ | O+B · **دفتر** |

### 3.2 الضمانات — تحقّق آلي (اختبارات تفشل تلقائيًا عند الخرق)

| الضمان | الآلية | الحالة |
|--------|--------|--------|
| كل جدول في `public` عليه RLS | اختبار تغطية | ✅ 42/42 |
| كل جدول عليه سياسة واحدة على الأقل | اختبار تغطية | ✅ |
| **كل سياسة UPDATE/ALL لها WITH CHECK** | اختبار تغطية | ✅ — يمنع نقل الصفوف بين الفروع |
| كل جدول بـ`organization_id` يفلتر بالمنشأة في SELECT | اختبار تغطية | ✅ |
| كل دالة `SECURITY DEFINER` في `app` تضبط `search_path` | اختبار تغطية | ✅ |
| لا سياسة UPDATE/DELETE على أي دفتر | اختبار تغطية | ✅ |
| **لا دالة في `app` ممنوحة لـ PUBLIC** | اختبار تغطية (**جديد**) | ✅ |
| `authenticated` يملك دوال القراءة الست فقط | اختبار تغطية (**جديد**) | ✅ |

### 3.3 مراجعة دوال SECURITY DEFINER

| الدالة | `search_path=''` | مكشوفة للعميل | الحكم |
|--------|------------------|----------------|-------|
| `app.current_user_id()` | ✅ | `authenticated` فقط | سليمة — لا تقبل وسائط |
| `app.current_org_id()` | ✅ | `authenticated` فقط | سليمة |
| `app.is_active_user()` | ✅ | `authenticated` فقط | سليمة |
| `app.has_permission(text)` | ✅ | `authenticated` فقط | سليمة — تقرأ صلاحيات **المستدعي** فقط (`auth.uid()`)، لا تقبل هوية من الوسيط |
| `app.has_org_scope()` | ✅ | `authenticated` فقط | سليمة |
| `app.can_access_branch(uuid)` | ✅ | `authenticated` فقط | سليمة — تُرجع boolean لا بيانات |
| `app.apply_rls(...)` | ✅ | **❌ كانت مكشوفة** | 🔴 **CRITICAL-01 — أُصلحت** |
| `app.apply_audit_triggers(text)` | ✅ | **❌ كانت مكشوفة** | 🔴 **CRITICAL-01 — أُصلحت** |
| `app.set_audit_fields()` | ✅ | محفّز | محجوبة الآن |
| `app.guard_profile_sensitive_fields()` | ✅ | محفّز | محجوبة الآن |
| `app.guard_financial_transaction()` | ✅ | محفّز | محجوبة الآن |
| `app.apply_stock_movement()` | ✅ | محفّز | محجوبة الآن |
| `app.recalculate_purchase_order_total()` | ✅ | محفّز | محجوبة الآن |
| `app.recalculate_stock_levels(uuid)` | ✅ | لا | كانت سليمة أصلًا |
| `app.set_updated_at()` · `app.prevent_mutation()` | ✅ | `SECURITY INVOKER` | سليمة |

**لا توجد دالة تُرجع بيانات صفوف** — كلها تُرجع `boolean` أو `uuid` أو `void`. هذا يقلّل سطح التسريب جذريًا.

### 3.4 العزل متعدد المستأجرين — تقييم القابلية للتوسع

| المتطلب | مدعوم؟ | التفصيل |
|---------|--------|---------|
| أكثر من Organization | ✅ | `organization_id` على كل جدول وكل سياسة. إضافة منشأة = صفوف، لا ترحيل |
| أكثر من Branch | ✅ | مُثبَت باختبارات |
| مستخدم بعدة فروع | ✅ | `user_branches` علاقة many-to-many |
| مستخدم يرى فروعًا محددة | ✅ | مُثبَت |
| **Regional Supervisor مستقبلًا** | ✅ **بلا إعادة بناء** | انظر أدناه |

**تقييم Regional Supervisor (لم يُنفَّذ — بناءً على طلبك):**

كل سياسات الفروع تمر عبر دالة واحدة: `app.can_access_branch(uuid)`. إضافة «مشرف منطقة» تتطلب:

1. جدولين جديدين: `branch_groups` و`branch_group_branches`.
2. عمود `branch_group_id` على `user_roles` (أو جدول `user_branch_groups`).
3. **تعديل دالة واحدة فقط** — إضافة فرع `when has_group_scope() then branch in (…)`.

**السياسات الـ126 لا تتغير إطلاقًا.** هذا أهم عائد معماري لقرار تمرير كل فحص فرع عبر دالة واحدة.
التكلفة التقديرية: ترحيل واحد + تعديل دالة + اختبارات. **لا إعادة بناء.**

⚠️ الشرط الوحيد لبقاء هذه التكلفة منخفضة: **ألّا تُكتب أي سياسة مستقبلية تفحص `branch_id` مباشرةً بدل استدعاء الدالة.** اختبار تغطية يفرض ذلك جزئيًا؛ يُنصح بتشديده (انظر §7).

---

## 4. النتائج الأمنية

### 🔴 CRITICAL-01 — تصعيد صلاحيات عبر دوال `app` الإدارية — **أُصلحت**

| البند | التفصيل |
|-------|---------|
| **المشكلة** | PostgreSQL يمنح `EXECUTE` لـ`PUBLIC` على كل دالة جديدة. الترحيل الأصلي سحب الامتياز من دوال القراءة الست فقط، وترك `app.apply_rls` و`app.apply_audit_triggers` مكشوفتين لدور `authenticated`. |
| **التأثير** | **سقوط نموذج الأمان بالكامل.** أي موظف بحساب صالح ينفّذ:<br>`select app.apply_rls('customers','customers.view',…, p_branch => false);`<br>فتُحذف سياسات الجدول وتُعاد كتابتها بلا شرط فرع. |
| **الإثبات العملي** | مستخدم فرع أ-1 كان يرى **1** عميل → بعد الاستدعاء رأى **2** → ثم **حذف صف فرع أ-2**. كما أسقط محفّزات التدقيق فاختفى أثر الفعل. |
| **السبب الجذري** | الاعتماد على سحب الامتياز **يدويًا لكل دالة** بدل قاعدة عامة على مستوى المخطط. خطأ سهل التكرار مع كل دالة جديدة. |
| **الحل المُنفَّذ** | (1) حلقة تسحب `EXECUTE` من `PUBLIC` عن **كل** دوال `app` الحالية.<br>(2) `alter default privileges in schema app revoke execute on functions from public` ⇒ الدوال المستقبلية محجوبة تلقائيًا.<br>(3) منح صريح لدوال القراءة الست فقط.<br>(4) **اختبارا انحدار**: لا دالة ممنوحة لـPUBLIC، و`authenticated` يملك الست فقط بالاسم. |
| **يحتاج Migration؟** | ✅ `20260817070000_security_hardening.sql` |
| **يؤثر على Architecture؟** | ❌ لا — تشديد امتيازات فقط |

> **لماذا لم تكشفها الاختبارات السابقة؟** كان اختبار «anon لا ينفّذ دوال الأمان» يغطي دوال القراءة فقط. الدرس: اختبار **قوائم بيضاء شاملة** (ما المسموح؟) أقوى من اختبار حالات فردية (هل هذا ممنوع؟). الاختبار الجديد يعتمد القائمة البيضاء.

### 🟠 HIGH-01 — السجلات المشتركة غير مرئية لموظفي الفروع — **أُصلحت**

| البند | التفصيل |
|-------|---------|
| **المشكلة** | 13 جدولًا تحمل `branch_id` قابلًا للإفراغ حيث `NULL` = «سجل على مستوى المنشأة»، لكن `can_access_branch(null)` تُرجع `false` لغير أصحاب نطاق المنشأة. |
| **التأثير** | كتالوج الخدمات والأصناف والوحدات والموردين والأقسام المركزية **يظهر فارغًا تمامًا** لكل موظف فرع. النظام غير قابل للاستخدام لأي دور غير مدير المنشأة. |
| **السبب الجذري** | القالب يعامل `NULL` كـ«فرع غير مصرّح» بدل «مورد مشترك». التباس دلالي في تصميم القالب. |
| **الحل المُنفَّذ** | علم `p_org_level_readable` على مستوى الجدول:<br>• **القراءة**: `branch_id is null or can_access_branch(branch_id)`<br>• **الكتابة**: نطاق فرع صارم كما هو ⇒ موظف الفرع **لا يستطيع** إنشاء سجل مشترك ولا تحويل سجل فرعه إلى مشترك.<br>مُطبَّق على 10 جداول مرجعية فقط، وليس على الجداول التشغيلية. |
| **اختبارات** | ✅ الموظف يقرأ الخدمة المشتركة · ✅ لا يستطيع إنشاءها · ✅ لا تعبر حدود المنشأة |
| **يحتاج Migration؟** | ✅ نفس الملف |
| **يؤثر على Architecture؟** | ⚠️ نعم جزئيًا — دلالة `branch_id = NULL` صارت رسمية: «سجل مشترك للقراءة داخل المنشأة» |

### 🟠 HIGH-02 — لا ضمان بأن البند يتبع فرع مستنده — **أُصلحت**

| البند | التفصيل |
|-------|---------|
| **المشكلة** | بنود المستندات تحمل `branch_id` مستقلًا، ومفتاحها الأجنبي يشير إلى `id` الأب فقط. سياسة الإدراج تفحص فرع **البند** لا فرع **الأب**. |
| **التأثير** | مستخدم فرع أ يُلحق بند قيد بحركة مالية في فرع ب (لا يقرأها لكنه يفسد مجاميعها). فساد بيانات مالية عابر للفروع. |
| **الحل المُنفَّذ** | مفاتيح أجنبية مركّبة `(parent_id, branch_id) → parent(id, branch_id)` على 5 علاقات تركيبية: `financial_entries`، `purchase_order_items`، `purchase_request_items`، `goods_receipt_items`، `stock_levels`. المحرّك نفسه يرفض عدم التطابق. |
| **اختبار** | ✅ رفض إلحاق بند قيد بحركة في فرع آخر |
| **يحتاج Migration؟** | ✅ نفس الملف (يضيف `unique(id, branch_id)` على 5 جداول أب) |
| **يؤثر على Architecture؟** | ❌ تشديد تكامل مرجعي |

### 🟡 MEDIUM-01 — `audit_logs` يقبل محتوى من العميل

**المشكلة:** سياسة الإدراج تفرض `user_id = auth.uid()` و`organization_id` الصحيح، لكن `action` و`module` و`entity_type` و`old_values`/`new_values` تأتي كما أرسلها العميل.
**التأثير:** مستخدم خبيث يستطيع **حشو** سجل التدقيق بإدخالات مضللة (لا حذف ولا تعديل — الدفتر محمي). يُضعف قيمة السجل كدليل.
**السبب:** الكتابة تتم بجلسة المستخدم لتبسيط المسار.
**الحل المقترح:** نقل الكتابة إلى `app.write_audit_log(...)` بـ`SECURITY DEFINER` تُنشئ السجل من سياق موثوق، وسحب `INSERT` من `authenticated`.
**Migration؟** ✅ · **Architecture؟** ❌ · **الحالة:** مؤجّل — يُنفَّذ قبل الإنتاج، ليس قبل أول ترحيل.

### 🟡 MEDIUM-02 — مستلم الإشعار يستطيع تعديل محتواه

**المشكلة:** `notifications_update_own` مقصودة لتعليم «مقروء»، لكنها تسمح بتعديل أي عمود في صف المستخدم (`body`، `status`، `provider_message_id`).
**التأثير:** تزوير محتوى إشعار معروض، أو تعطيل تتبع التسليم.
**الحل المقترح:** محفّظ يرفض تغيير أي عمود عدا `read_at` عندما يكون المُعدِّل هو المستلم، أو دالة RPC مخصصة.
**Migration؟** ✅ · **Architecture؟** ❌ · **الحالة:** مؤجّل.

### 🟡 MEDIUM-03 — إنشاء المستخدمين والمنشآت يتطلب المفتاح السري

**المشكلة:** لا سياسة `INSERT` على `profiles` ولا على `organizations`.
**التأثير:** لا يمكن إنشاء مستخدم من التطبيق بلا `SUPABASE_SECRET_KEY`؛ وهو **قرار صحيح أمنيًا** (إنشاء المستخدم يمر عبر Auth Admin API) لكنه غير موثّق كتبعية تشغيلية.
**الحل:** توثيق مسار bootstrap (تم في DEPLOYMENT §6) + بناء مسار خادم محكوم بـ`identity.users.create` في المرحلة 3.
**Migration؟** ❌ · **Architecture؟** ❌

### 🟡 MEDIUM-04 — لا تكامل مرجعي على `created_by` / `updated_by`

**المشكلة:** أعمدة `uuid` بلا `REFERENCES`.
**التأثير:** قد تشير إلى مستخدم محذوف؛ التقارير تعرض معرّفًا بلا اسم.
**السبب:** متعمّد جزئيًا — تجنّب مشكلة البيضة والدجاجة عند إنشاء أول منشأة/مستخدم، وتجنّب حظر حذف المستخدم.
**الحل المقترح:** `references public.profiles(id) on delete set null` بعد إنشاء أول مستخدم، أو الإبقاء وتوثيقه.
**Migration؟** ✅ · **Architecture؟** ❌ · **الحالة:** مؤجّل — القرار مرتبط بسياسة الاحتفاظ (P-19).

### 🟡 MEDIUM-05 — المراجع الذاتية بلا حماية من الحلقات

**المشكلة:** `departments.parent_id` و`item_categories.parent_id` تسمحان ببناء حلقة (A→B→A).
**التأثير:** أي استعلام شجري تكراري يدخل حلقة لا نهائية.
**الحل المقترح:** محفّز يرفض الحلقة عبر `WITH RECURSIVE`، أو حد أقصى للعمق.
**Migration؟** ✅ · **Architecture؟** ❌ · **الحالة:** مؤجّل حتى بناء واجهة الأقسام (المرحلة 3).

### 🟢 LOW-01 — `integration` بلا RLS — **أُصلحت**
كانت محميّة بعدم كشفها عبر PostgREST وبعدم منح `usage`. فُعِّلت RLS بلا سياسات (رفض صريح) كدفاع في العمق.

### 🟢 LOW-02 — لا فحص تنسيق على `currency`
`char(3)` بلا قيد على قائمة ISO-4217. **الحل:** `check (currency ~ '^[A-Z]{3}$')`. مؤجّل — يحتاج قرار العملات المدعومة (P-20).

### 🟢 LOW-03 — أعمدة زائدة على الدفاتر
`stock_movements.updated_at/updated_by` لن تتغير أبدًا. تركها لا يضر؛ حذفها تنظيف تجميلي. **مؤجّل.**

### 🟢 LOW-04 — `branch_services` بلا `updated_at`
له سياسة UPDATE بلا أثر زمني. **مؤجّل.**

### 🟢 LOW-05 — لا تحقق من تنسيق الهاتف في قاعدة البيانات
`text` حر؛ التحقق في Zod فقط. مقبول — تنسيق الهاتف قرار عمل (Q-05).

---

## 5. نتائج الأداء

### 5.1 الفهارس — قبل وبعد

| المؤشر | قبل | بعد |
|--------|-----|-----|
| إجمالي الفهارس | 138 | **181** |
| مفاتيح أجنبية بلا فهرس | **67** | **34** |

### 5.2 الفهارس المضافة ومبرر كل مجموعة

| المجموعة | العدد | المبرر |
|----------|-------|--------|
| `organization_id` على 11 جدولًا | 11 | يُقيَّم في **كل** سياسة RLS لكل صف. غيابه = مسح كامل على كل استعلام |
| `financial_entries(organization_id, branch_id)` | 1 | مركّب لأن السياسة تفحص العمودين معًا |
| مفاتيح الأب في جداول البنود | 10 | البنود تُجلب دائمًا عبر الأب؛ وبلا فهرس يصبح حذف الأب مسحًا كاملًا |
| الروابط المالية (حركة/خزينة/أمر) | 9 | يُستعلَم عنها من الطرفين في التسويات والتقارير |
| روابط المستخدمين (`opened_by`, `closed_by`, `requested_by`…) | 8 | مطلوبة عند تعطيل مستخدم وفي تقارير المسؤولية |
| `roles(organization_id)` · `profiles(department_id)` · `notifications(recipient_customer_id)` | 3 | فلترة متكررة في الواجهات |

### 5.3 الفهارس المتروكة عمدًا (34 مفتاحًا)

| المجموعة | لماذا لا نفهرسها |
|----------|------------------|
| `branch_id` على 15 جدولًا مرجعيًا | معظم صفوفها `NULL` (سجلات مشتركة)؛ الفهرس شبه فارغ وقليل الانتقائية. يُعاد النظر عند وجود بيانات حقيقية |
| مفاتيح `units` و`item_categories` (7) | جداول مرجعية صغيرة (عشرات الصفوف) — المسح المتسلسل أسرع من الفهرس |
| مفاتيح `integration.*` (4) | لا استعلامات تشغيلية عليها |
| مفاتيح مركّبة أُنشئت للتو (5) | مغطاة بالفهرس الفريد على `(id, branch_id)` في الأب |
| `departments.parent_id` · `item_categories.parent_id` | أشجار صغيرة |

> **مبدأ:** كل فهرس تكلفة كتابة دائمة. لا يُضاف فهرس بلا استعلام معروف يستفيد منه.

### 5.4 فهارس البحث وRLS

| النوع | الحالة |
|-------|--------|
| بحث نصي جزئي عربي | ✅ GIN + `pg_trgm` على `customers.full_name_ar`, `customers.phone`, `items.name_ar` |
| فهارس فريدة جزئية | ✅ `where deleted_at is null` على العملاء ⇒ إعادة استخدام هاتف عميل محذوف |
| فهارس RLS الحرجة | ✅ `user_branches(user_id)` (PK) · `user_roles(user_id)` · `role_permissions(role_id)` (PK) |

### 5.5 ملاحظات أداء غير محلولة

| # | الملاحظة | الحالة |
|---|----------|--------|
| PERF-01 | `app.has_permission` تُنفَّذ **مرة لكل صلاحية لكل استعلام**. `(select …)` يجعلها InitPlan (تقييم واحد)، لكن استعلامًا يفحص 3 صلاحيات = 3 استعلامات فرعية. **الحل عند ظهور بطء:** حقن الصلاحيات في JWT كـ custom claims عبر Auth Hook ⇒ صفر استعلامات. البنية تسمح به بلا تغيير في السياسات. | مؤجّل — يحتاج قياسًا على بيانات حقيقية |
| PERF-02 | `stock_levels` جدول مشتق يُحدَّث بمحفّز لكل حركة. عند إدخال دفعات كبيرة يصبح نقطة تنازع (row lock). **الحل عند الحاجة:** تجميع الحركات ثم تحديث دفعي. | مؤجّل |
| PERF-03 | لا تجزئة (partitioning) على `audit_logs` و`stock_movements` و`treasury_movements`. عند تجاوز عشرات الملايين تصبح مطلوبة. مفتاح التجزئة الطبيعي: `created_at`/`occurred_at` شهريًا. | مؤجّل — تصميم الأعمدة يسمح به |
| PERF-04 | لم يُقَس أي استعلام على حجم حقيقي. كل ما سبق تحليل بنيوي لا قياس. | ⚠️ تصريح صريح |

---

## 6. مراجعة الترحيلات

### 6.1 الترتيب والاعتماديات

| # | الملف | يعتمد على | الحالة |
|---|-------|-----------|--------|
| 1 | `20260816000000_init_foundation` | — | ✅ ينشئ المخططات والامتدادات ودوال البنية |
| 2 | `20260817001000_identity_rbac` | 1 (`app`، `set_updated_at`) | ✅ ينشئ `apply_rls` قبل أول استخدام لها |
| 3 | `20260817002000_core_entities` | 2 (`apply_rls`، `organizations`، `branches`) | ✅ |
| 4 | `20260817003000_inventory` | 2، 1 (`prevent_mutation`) | ✅ |
| 5 | `20260817004000_purchasing` | 3، 4 (`items`، `units`، `suppliers`) | ✅ |
| 6 | `20260817005000_finance` | 4، 5 (`purchase_orders`، `suppliers`) | ✅ |
| 7 | `20260817060000_notifications_files_audit` | 2، 3 (`customers`، `profiles`) | ✅ |
| 8 | `20260817070000_security_hardening` | 2–7 (يعدّل ما سبق) | ✅ |

**لا اعتمادية مكسورة.** التحقق ليس نظريًا: **كل تشغيل لاختبارات RLS يبني قاعدة فارغة تمامًا ويطبّق الثمانية بالترتيب** — وهذا حدث عشرات المرات أثناء هذه المراجعة.

### 6.2 قابلية التنفيذ من قاعدة فارغة

✅ **مُثبَتة آليًا.** `pnpm test:rls` = `initdb` جديد + بوت Supabase + 8 ترحيلات + بذور + 47 اختبارًا.

### 6.3 Idempotency

| الملف | idempotent؟ | التفصيل |
|-------|-------------|---------|
| 1–7 | ✅ **نعم** | `create table if not exists` · `create index if not exists` · `drop policy if exists` قبل كل `create policy` · `create or replace function` |
| 8 | ⚠️ **جزئيًا** | حلقة الامتيازات والفهارس idempotent، لكن `alter table … add constraint` و`drop constraint … add constraint` **تفشل عند إعادة التشغيل** |

**الحكم:** مقبول. Supabase يتتبّع الترحيلات المُطبَّقة ولا يعيد تشغيلها. جعل `ADD CONSTRAINT` idempotent يتطلب كتل `DO` تفحص `pg_constraint` — تعقيد بلا عائد في مسار مُدار.
**لكن:** لو نُفِّذ الملف يدويًا مرتين (SQL Editor) فسيفشل في المنتصف. **⚠️ نفّذه عبر `supabase db push` فقط.**

### 6.4 العمليات الهدّامة

| العملية | الملف | الخطورة |
|---------|-------|---------|
| `drop function app.apply_rls(7 args)` | 8 | 🟢 لا خطر — تُعاد فورًا بتوقيع من 8 وسائط |
| `drop constraint … fkey` ×5 ثم إعادتها مركّبة | 8 | 🟡 على قاعدة **فارغة** لا خطر. على قاعدة بها بيانات، `ADD CONSTRAINT` **يتحقق من الصفوف القائمة** وقد يفشل إن وُجد بند بفرع مخالف لأبيه |
| `revoke` على دوال `app` | 8 | 🟢 لا فقدان بيانات |
| `drop policy if exists` قبل إعادة الإنشاء | 3–8 | 🟢 السياسات تُعاد فورًا في نفس المعاملة |

**لا يوجد `DROP TABLE` ولا `DROP COLUMN` ولا `DELETE` على بيانات في أي ترحيل.**
**لا توجد بيانات إنتاج معرّضة للحذف** — القاعدة الحقيقية فارغة ولم تُطبَّق عليها أي ترحيلات.

### 6.5 اعتبارات التراجع (Rollback)

| البند | الحالة |
|-------|--------|
| ترحيلات عكسية (down migrations) | ❌ غير موجودة — Supabase يعتمد اتجاهًا واحدًا |
| استراتيجية التراجع الفعلية | استعادة نسخة احتياطية نقطية (PITR) |
| **قبل أول ترحيل** | لا حاجة — القاعدة فارغة، التراجع = `supabase db reset` |
| **بعد وجود بيانات** | ⚠️ **إلزامي**: نسخة احتياطية قبل كل `db push`، وتفعيل PITR على المشروع |
| ترحيلات مستقبلية هدّامة | يجب أن تُقسَّم: (1) إضافة → (2) نقل بيانات → (3) حذف — في ترحيلات منفصلة ونشرات منفصلة |

---

## 7. التعديلات الموصى بها

### 7.1 نُفِّذت في هذه المراجعة

| # | التعديل | الأثر |
|---|---------|-------|
| ✅ 1 | سحب `EXECUTE` من PUBLIC عن كل دوال `app` + قاعدة افتراضية للمستقبل | إغلاق CRITICAL-01 |
| ✅ 2 | علم `p_org_level_readable` وإعادة توليد سياسات 10 جداول مرجعية | إغلاق HIGH-01 |
| ✅ 3 | 5 مفاتيح أجنبية مركّبة `(id, branch_id)` | إغلاق HIGH-02 |
| ✅ 4 | 43 فهرسًا جديدًا بمبرر موثّق لكل مجموعة | أداء RLS والحذف |
| ✅ 5 | تفعيل RLS على `integration.*` | دفاع في العمق |
| ✅ 6 | 9 اختبارات انحدار جديدة (47 بدل 38) | منع تكرار الثغرات |
| ✅ 7 | إصلاح `auth.uid()` في منصة الاختبار (كانت تُحوِّل سلسلة فارغة إلى JSON) | **عيب في المنصة لا في المخطط** |

### 7.2 قبل أول ترحيل حقيقي — لا شيء إلزامي

بعد الإصلاحات أعلاه **لا يوجد ما يمنع تطبيق الترحيلات.** التوصيات الباقية كلها قابلة للتنفيذ لاحقًا بترحيل إضافي بلا كسر.

### 7.3 قبل الإنتاج (بعد الترحيل، قبل المستخدمين الحقيقيين)

| # | التعديل | السبب | Migration؟ |
|---|---------|-------|-----------|
| 1 | `app.write_audit_log()` بـ`SECURITY DEFINER` وسحب `INSERT` من `authenticated` | MEDIUM-01 | ✅ |
| 2 | حصر تعديل الإشعار على `read_at` للمستلم | MEDIUM-02 | ✅ |
| 3 | منع الحلقات في `parent_id` | MEDIUM-05 | ✅ |
| 4 | `check (currency ~ '^[A-Z]{3}$')` | LOW-02 | ✅ |
| 5 | تشديد اختبار التغطية: كل سياسة تفحص فرعًا يجب أن تستدعي `can_access_branch` لا `branch_id` مباشرةً | يحمي مسار Regional Supervisor | ❌ اختبار فقط |
| 6 | Rate limiting صريح + CSP | مذكوران في SECURITY §7 | ❌ |

### 7.4 قابلة للتأجيل بأمان

| # | التعديل | متى |
|---|---------|-----|
| 1 | FK على `created_by`/`updated_by` | مع سياسة الاحتفاظ (P-19) |
| 2 | حذف الأعمدة الزائدة على الدفاتر | تنظيف دوري |
| 3 | `updated_at` على `branch_services` | مع واجهة الخدمات |
| 4 | حقن الصلاحيات في JWT | عند قياس بطء فعلي |
| 5 | تجزئة الجداول الدفترية | عند تجاوز عشرات الملايين |
| 6 | فهارس `branch_id` على الجداول المرجعية | بعد رؤية توزيع البيانات الحقيقي |

---

## 8. قرارات عالية المخاطر

قرارات لو أُجِّل تغييرها تصبح مكلفة جدًا:

| # | القرار | لماذا مكلف لاحقًا | الحكم بعد المراجعة |
|---|--------|-------------------|--------------------|
| 1 | **كل فحص فرع يمر عبر `app.can_access_branch`** | لو تسرّبت سياسة تفحص `branch_id` مباشرةً، فإضافة Regional Supervisor تتحول من تعديل دالة واحدة إلى مراجعة 126 سياسة | ✅ **مُلتزَم به حاليًا 100%** — يجب فرضه باختبار (§7.3.5) |
| 2 | **الدفاتر append-only** | تحويل جدول دفتري إلى قابل للتعديل يبطل كل ضمانات التدقيق المالي بأثر رجعي | ✅ سليم — يُنصح **بعدم** المساس به |
| 3 | **`numeric(18,4)` للمال** | تحويل نوع عمود على ملايين الصفوف = قفل جدول طويل | ✅ صفر أعمدة عائمة |
| 4 | **UUID مفاتيح أساسية** | تغييره يمس 137 مفتاحًا أجنبيًا | ✅ سليم؛ `audit_logs` استثناء صحيح بـ`bigint` |
| 5 | **دلالة `branch_id = NULL` = سجل مشترك** | صارت رسمية بعد HIGH-01. تغييرها لاحقًا يعني مراجعة كل جدول مرجعي | ⚠️ **قرار جديد يحتاج تأكيدك** |
| 6 | **`profiles` بدل جدول `doctors`** | فصلهما لاحقًا يتطلب ترحيل بيانات وتغيير الحجوزات والصلاحيات | ✅ سليم ما دام مقدّم الخدمة **موظفًا** له حساب. ⚠️ لو ظهر «طبيب زائر بلا حساب نظام» فسيحتاج إعادة نظر — **سؤال للعميل** |
| 7 | **`SECURITY DEFINER` بمالك يتجاوز RLS** | أساس نموذج الأمان كله | ✅ سليم — وأصبح محميًا بعد CRITICAL-01 |
| 8 | **`app.apply_rls` كمصدر وحيد للسياسات** | لو كُتبت سياسات يدوية متفرقة ضاعت المراجعة المركزية | ✅ 32 جدولًا مولّدة · 10 يدوية مبرَّرة وموثّقة |

---

## 9. قواعد العمل المعلّقة

**لم تتأثر بهذه المراجعة.** العشرون قاعدة (P-01…P-20) لا تزال معلّقة، ولم يُبنَ لأيٍّ منها منطق.
المرجع: [`registry.ts`](../packages/core/src/pending/registry.ts) · [REQUIREMENTS.md §2](./REQUIREMENTS.md)

**أسئلة جديدة ظهرت من المراجعة نفسها:**

| # | السؤال | لماذا ظهر الآن |
|---|--------|----------------|
| RQ-01 | هل «سجل على مستوى المنشأة» (خدمة/صنف/مورد مشترك) مفهوم صحيح في عملكم؟ أم كل شيء يخص فرعًا؟ | HIGH-01 جعل الدلالة رسمية |
| RQ-02 | هل يمكن أن يكون مقدّم الخدمة (طبيب) **بلا حساب مستخدم** في النظام؟ | يحدد بقاء قرار `profiles.is_service_provider` |
| RQ-03 | هل يجوز لأكثر من مستخدم فتح وردية على **نفس الخزينة** في آن واحد؟ | القيد الحالي يمنع تكرار المستخدم على نفس الخزينة فقط |
| RQ-04 | ما العملات المدعومة فعليًا؟ | يحدد قيد `currency` |
| RQ-05 | ما سياسة الاحتفاظ بسجل التدقيق؟ (يحدد التجزئة والأرشفة) | PERF-03 |

---

## 10. التوصية النهائية

### A. هل الـDatabase Foundation جاهزة للمراجعة البشرية؟

**نعم.** المخطط مكتمل ومتّسق ومُوثَّق، وكل ادعاء في هذا التقرير مستخرج آليًا من المحرّك لا من قراءة ملفات.
نقاط التركيز لمراجعك البشري: (1) قالب `app.apply_rls` — هو **القالب الأمني الوحيد**؛ (2) العشر سياسات اليدوية؛ (3) القرارات في §8.

### B. هل الـRLS Architecture آمنة بناءً على الاختبارات الحالية؟

**آمنة ضمن ما اختُبر — مع تحفّظ مهم.**

✅ **مُثبَت:** عزل الفروع والمنشآت · فرض الصلاحيات · حجب المستخدم المعطّل · منع نقل الصفوف · منع التصعيد الذاتي · عدم قابلية الدفاتر للتعديل · حجب `anon` · حجب دوال `app` · تطابق نطاق الأب والابن. **47 اختبارًا، كلها تمر.**

⚠️ **التحفّظ:** المراجعة نفسها كشفت ثغرة CRITICAL نجت من 38 اختبارًا سابقًا. **الاختبارات تثبت ما اختُبر فقط.** ما لم يُختبر بعد: السلوك على Supabase الحقيقي، تكامل Auth الفعلي، سياسات Storage، والأداء على حجم حقيقي.

**الحكم:** النموذج آمن بما يكفي **لتطبيق الترحيلات على مشروع staging** والبدء بالتحقق الحي. **ليس** جاهزًا لبيانات إنتاج قبل بنود §7.3.

### C. ما يجب تنفيذه قبل أول Migration حقيقي

**نُفِّذ بالكامل. لا يوجد بند متبقٍ.**

1. ✅ CRITICAL-01 · 2. ✅ HIGH-01 · 3. ✅ HIGH-02 · 4. ✅ فهارس RLS · 5. ✅ اختبارات الانحدار

> السبب في إلزاميتها قبل الترحيل تحديدًا: الثلاثة الأولى تمس **بنية** (سياسات، مفاتيح مركّبة، قيود فريدة). تطبيقها على قاعدة فارغة مجاني؛ وعلى قاعدة بها بيانات قد يفشل التحقق ويستلزم تنظيف بيانات أولًا.

### D. ما يمكن تأجيله

كل ما في §7.3 و§7.4 — لأنها إضافات لا تكسر بيانات قائمة: دوال جديدة، قيود على أعمدة موجودة، فهارس، تنظيف. **لا شيء منها يستلزم إعادة كتابة سياسات أو نقل بيانات.**

### E. قرارات مطلوبة من العميل

| # | القرار | الأثر |
|---|--------|-------|
| 1 | RQ-01: هل «السجل المشترك على مستوى المنشأة» مفهوم صحيح؟ | يؤكد أو ينقض إصلاح HIGH-01 |
| 2 | RQ-02: طبيب بلا حساب مستخدم؟ | قد يستلزم فصل `service_providers` — **مكلف لاحقًا** |
| 3 | Q-02 (السابق): هل يوجد مشرف منطقة؟ | التكلفة منخفضة الآن ومنخفضة لاحقًا — البنية جاهزة |
| 4 | RQ-03: وردية واحدة لكل خزينة أم لكل مستخدم؟ | يحدد الفهرس الفريد |
| 5 | RQ-04: العملات المدعومة | قيد `currency` |
| 6 | من يطبّق الترحيلات؟ ومفتاح Publishable صالح | يحجب التحقق الحي |

### F. ما الذي يصبح تغييره مكلفًا جدًا لو أُجِّل الآن؟

| # | البند | لماذا الآن تحديدًا |
|---|-------|-------------------|
| 1 | **المفاتيح المركّبة `(id, branch_id)`** | ✅ نُفِّذت. لو أُجِّلت، فإضافتها على جدول به ملايين الصفوف = فحص كامل + قفل طويل، وقد تفشل إن وُجدت بيانات مخالفة تحتاج تنظيفًا يدويًا |
| 2 | **حجب دوال `app`** | ✅ نُفِّذ. تأجيله = تشغيل النظام بثغرة تسمح لأي موظف بقراءة وحذف بيانات كل الفروع |
| 3 | **دلالة السجل المشترك** | ✅ نُفِّذت. تغييرها بعد إدخال كتالوجات فعلية يعني إعادة تصنيف كل صف يدويًا |
| 4 | **`RQ-02` طبيب بلا حساب** | ⚠️ **لم يُحسم.** فصل مقدّمي الخدمة عن `profiles` بعد وجود حجوزات = ترحيل بيانات + تغيير الصلاحيات + تغيير الواجهات |
| 5 | **تجزئة الجداول الدفترية** | 🟢 قابل للتأجيل بأمان — التجزئة اللاحقة عملية معروفة، والأعمدة جاهزة |
| 6 | **حقن الصلاحيات في JWT** | 🟢 قابل للتأجيل — تحسين خلف نفس الدوال |

---

## ملحق: كيف تُعاد هذه المراجعة

```bash
pnpm test:rls
```

```bash
node scripts/introspect-schema.mjs
```

الأول ينفّذ 47 اختبارًا على قاعدة مبنية من الصفر. الثاني يُخرج `.tmp/schema-snapshot.json` بكل الحقائق أعلاه.
**أي ادعاء في هذا التقرير قابل لإعادة التحقق بهذين الأمرين.**

# API — اتفاقيات الواجهة البرمجية

> **الحالة:** الاتفاقيات **مُنفَّذة ومفروضة برمجيًا** عبر
> [`defineAction` / `defineQuery`](../apps/web/src/shared/lib/action.ts).
> كل Server Action يمر بالغلاف؛ تجاوزه يعني كتابة الفحوص يدويًا — وهو ما ترصده المراجعة.
>
> المرجع التطبيقي الكامل: وحدة العملاء
> ([schemas](../apps/web/src/modules/customers/schemas.ts) ·
> [repository](../apps/web/src/modules/customers/repository.ts) ·
> [actions](../apps/web/src/modules/customers/actions.ts)).

---

## 1. أنماط الاتصال

| النمط | متى يُستخدم | المكان |
|-------|-------------|--------|
| **Server Components** | قراءة بيانات لعرضها في صفحة | مباشرة داخل الصفحة عبر Repository |
| **Server Actions** | كل عمليات الكتابة القادمة من الواجهة | `modules/<module>/actions/*.ts` |
| **Route Handlers** | Webhooks، تصدير ملفات، مستهلكون خارجيون | `app/api/**/route.ts` |

**لماذا Server Actions للكتابة؟** حماية CSRF مدمجة، تكامل مع `revalidatePath`, وأنواع TypeScript من طرف لطرف بلا طبقة عميل HTTP.
**لماذا Route Handlers موجودة أيضًا؟** لأن الأنظمة الخارجية والتصدير لا يستطيعان استدعاء Server Action.

---

## 2. النمط الإلزامي لأي نقطة دخول

كل Server Action / Route Handler **يجب** أن يمر بهذه المراحل بهذا الترتيب:

```ts
export const createCustomerAction = defineAction({
  permission: 'customers.create',      // 1) requireAuth → 401   2) فحص صلاحية → 403
  schema: customerCreateSchema,        // 3) تحقق Zod → 422
  handler: async (ctx, input) => {
    requireBranchAccess(ctx, input.branchId);   // 4) نطاق الفرع → 403
    const customer = await createCustomer(ctx, input);  // 5) منطق العمل
    revalidatePath('/customers');
    return customer;
  },
  audit: (_ctx, input, output) => ({   // 6) سجل تدقيق (مع تنقية الحقول الحساسة)
    action: 'customer.created',
    module: 'customers',
    entityType: 'customer',
    entityId: output.id,
    branchId: input.branchId,
    newValues: { fullNameAr: output.fullNameAr, phone: output.phone },
  }),
});
```

**قاعدة مُلزِمة:** `organizationId` **لا يُقبل من العميل إطلاقًا** — يُشتق من الجلسة
داخل الـ repository. قبوله من الطلب يفتح باب انتحال المنشأة.

> المرحلتان 2 و4 **لا تُغنيان** عن RLS — هما لإرجاع خطأ واضح وقابل للتدقيق. RLS يبقى الضامن.

---

## 3. غلاف الاستجابة الموحّد (Response Envelope)

نجاح:
```json
{ "success": true, "data": { "...": "..." }, "meta": { "page": 1, "pageSize": 25, "total": 132 } }
```

فشل:
```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "لا تملك صلاحية تنفيذ هذا الإجراء",
    "details": { "required": "customers.create" }
  }
}
```

- `message` **بالعربية** وموجّه للمستخدم.
- `details` لا يحتوي أي معلومة بنيوية داخلية (أسماء جداول، استعلامات، آثار الاستثناءات).
- المعرّف `code` ثابت وقابل للترجمة والاختبار.

### أكواد الأخطاء المعتمدة

| Code | HTTP | المعنى |
|------|------|--------|
| `UNAUTHENTICATED` | 401 | لا توجد جلسة صالحة |
| `PERMISSION_DENIED` | 403 | جلسة صالحة بلا صلاحية |
| `BRANCH_ACCESS_DENIED` | 403 | خارج نطاق فروع المستخدم |
| `NOT_FOUND` | 404 | غير موجود أو خارج نطاق الرؤية |
| `VALIDATION_ERROR` | 422 | فشل تحقق Zod |
| `CONFLICT` | 409 | تعارض (تكرار كود، حالة غير متوافقة) |
| `BUSINESS_RULE_PENDING` | 501 | قاعدة عمل لم تُعتمد بعد — **متعمّد** |
| `RATE_LIMITED` | 429 | تجاوز الحد |
| `INTERNAL_ERROR` | 500 | خطأ غير متوقع (يُسجَّل، ولا تُكشف تفاصيله) |

> `BUSINESS_RULE_PENDING` ليس خطأ برمجيًا — هو إشارة صريحة بأن العميل لم يعتمد القاعدة بعد. أفضل من تنفيذ منطق مُخترَع بصمت.

---

## 4. اتفاقيات القوائم

| المعامل | القيمة الافتراضية | ملاحظات |
|---------|-------------------|---------|
| `page` | 1 | يبدأ من 1 |
| `pageSize` | 25 | الحد الأقصى 100 |
| `sort` | حسب الوحدة | صيغة `field:asc\|desc` |
| `search` | — | يُطبَّق على حقول محددة لكل وحدة |
| `branchId` | فرع المستخدم الافتراضي | يُتحقق دائمًا من نطاق الوصول |
| `from` / `to` | — | فترة زمنية بصيغة ISO |

الترقيم من طرف الخادم دائمًا — **ممنوع** جلب مجموعة كاملة وترشيحها في المتصفح.

---

## 5. القواعد العامة

1. أسماء الحقول في الـ API بصيغة `camelCase`؛ التحويل من/إلى `snake_case` يتم في طبقة الـ Repository فقط.
2. ممنوع تمرير `organization_id` من العميل — يُشتق دائمًا من جلسة المستخدم في الخادم.
3. كل عملية كتابة مؤثرة تُنتج سجل تدقيق.
4. العمليات المالية والمخزنية تقبل `idempotencyKey` لمنع التكرار عند إعادة الإرسال.
5. أي تغيير غير متوافق مع الإصدار السابق يوثَّق هنا قبل التنفيذ.

import { z } from 'zod';

/**
 * مخططات التحقق لوحدة الهوية (المستخدمون والأدوار).
 *
 * ⚠️ `organizationId` غير موجود عمدًا — يُشتق من الجلسة في الخادم.
 * ⚠️ لا يوجد أي حقل كلمة مرور في أي مخطط هنا ولن يوجد: كلمات المرور تُدار في
 *    Supabase Auth حصرًا، ولا تُرسَل من نموذج ولا تُعاد إلى واجهة الإدارة.
 */

const scopeSchema = z.enum(['organization', 'branch'], {
  errorMap: () => ({ message: 'النطاق يجب أن يكون organization أو branch' }),
});

const accountStatusSchema = z.enum(['active', 'suspended']);

/** هاتف سعودي/دولي مبسّط. `phone` اختياري في Supabase Auth ولا نفرضه. */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+()\s-]{6,20}$/, 'رقم هاتف غير صالح')
  .optional()
  .or(z.literal(''));

/* ------------------------------ إنشاء مستخدم ------------------------------ */

export const userCreateSchema = z
  .object({
    fullNameAr: z.string().trim().min(3, 'الاسم قصير جدًا').max(200),
    email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح').max(320),
    phone: phoneSchema,
    jobTitle: z.string().trim().max(120).optional().or(z.literal('')),
    employeeCode: z.string().trim().max(50).optional().or(z.literal('')),
    roleId: z.string().uuid('اختر دورًا'),
    scope: scopeSchema,
    branchIds: z.array(z.string().uuid()).max(50).default([]),
    defaultBranchId: z.string().uuid().nullable().optional(),
    /**
     * ربط الحساب بمقدّم خدمة قائم (طبيب).
     * غيابه = مستخدم عادي. وجوده = قرار صريح من المدير بإنشاء حساب دخول
     * لطبيب — RQ-02: لا حساب مصادقة لطبيب إلا باختيار المدير.
     */
    providerId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.scope === 'organization' || v.branchIds.length > 0, {
    message: 'مستخدم بنطاق فرع يحتاج فرعًا واحدًا على الأقل',
    path: ['branchIds'],
  })
  .refine((v) => !v.defaultBranchId || v.branchIds.includes(v.defaultBranchId), {
    message: 'الفرع الافتراضي يجب أن يكون من الفروع المُسندة',
    path: ['defaultBranchId'],
  });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/* ------------------------------ تعديل مستخدم ------------------------------ */

/** بيانات الملف فقط — الدور والفروع لهما فعل منفصل بصلاحيات منفصلة. */
export const userUpdateSchema = z.object({
  id: z.string().uuid(),
  fullNameAr: z.string().trim().min(3, 'الاسم قصير جدًا').max(200).optional(),
  phone: phoneSchema,
  jobTitle: z.string().trim().max(120).optional().or(z.literal('')),
  employeeCode: z.string().trim().max(50).optional().or(z.literal('')),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/** الإيقاف/إعادة التفعيل فعل مستقل: أثره أمني ويُسجَّل بمفرده في التدقيق. */
export const userStatusSchema = z.object({
  id: z.string().uuid(),
  status: accountStatusSchema,
});
export type UserStatusInput = z.infer<typeof userStatusSchema>;

/** تغيير الدور والفروع معًا — استبدال ذري في قاعدة البيانات. */
export const userAssignmentSchema = z
  .object({
    id: z.string().uuid(),
    roleId: z.string().uuid('اختر دورًا'),
    scope: scopeSchema,
    branchIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((v) => v.scope === 'organization' || v.branchIds.length > 0, {
    message: 'مستخدم بنطاق فرع يحتاج فرعًا واحدًا على الأقل',
    path: ['branchIds'],
  });
export type UserAssignmentInput = z.infer<typeof userAssignmentSchema>;

/* -------------------------------- الأدوار -------------------------------- */

/**
 * ⚠️ الأدوار النظامية (organization_id = null) غير قابلة للتعديل من التطبيق —
 *    سياسات RLS تفرض ذلك. ما يُنشأ هنا هو أدوار خاصة بالمنشأة فقط.
 */
export const roleCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, 'المعرّف قصير جدًا')
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'المعرّف حروف لاتينية صغيرة وأرقام وشرطة سفلية فقط'),
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  /** الصلاحيات الممنوحة. القاعدة المفروضة في المحرّك: لا تمنح ما لا تملك. */
  permissionKeys: z.array(z.string().max(80)).max(200).default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = roleCreateSchema.partial().extend({
  id: z.string().uuid(),
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

/* ------------------------- ربط حساب بمقدّم خدمة -------------------------- */

export const providerAccountSchema = z.object({
  providerId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح').max(320),
  roleId: z.string().uuid('اختر دورًا'),
  branchIds: z.array(z.string().uuid()).min(1, 'اختر فرعًا واحدًا على الأقل').max(50),
});
export type ProviderAccountInput = z.infer<typeof providerAccountSchema>;

/* -------------------------------- القوائم -------------------------------- */

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  branchId: z.string().uuid().optional(),
});
export type UserListQueryInput = z.infer<typeof userListQuerySchema>;

export const userIdSchema = z.object({ id: z.string().uuid() });

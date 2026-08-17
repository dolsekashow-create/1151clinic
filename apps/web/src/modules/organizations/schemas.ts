import { z } from 'zod';

/**
 * مخططات التحقق لوحدة التنظيم (الفروع والأقسام).
 *
 * ⚠️ `organizationId` غير موجود عمدًا — يُشتق من الجلسة في الخادم.
 * ⚠️ `isPublic` **ليس** جزءًا من مخططات الإنشاء/التعديل: النشر فعل منفصل
 *    بصلاحية منفصلة (setPublish)، ومحفّز في قاعدة البيانات يفرض ذلك.
 */

const codeSchema = z
  .string()
  .trim()
  .min(2, 'الكود قصير جدًا')
  .max(30, 'الكود طويل جدًا')
  .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, 'الكود يقبل حروفًا لاتينية وأرقامًا وشرطات فقط');

const statusSchema = z.enum(['active', 'inactive']);

/* ------------------------------- الفروع ---------------------------------- */

export const branchCreateSchema = z.object({
  code: codeSchema,
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200),
  nameEn: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  timezone: z.string().trim().max(64).default('Asia/Riyadh'),
});
export type BranchCreateInput = z.infer<typeof branchCreateSchema>;

export const branchUpdateSchema = branchCreateSchema.partial().extend({
  id: z.string().uuid(),
  status: statusSchema.optional(),
});
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;

/* ------------------------------- الأقسام --------------------------------- */

export const departmentCreateSchema = z.object({
  code: codeSchema,
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200),
  /** null = قسم مركزي على مستوى المنشأة (يتطلب نطاق منشأة للإنشاء). */
  branchId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;

export const departmentUpdateSchema = departmentCreateSchema.partial().extend({
  id: z.string().uuid(),
  status: statusSchema.optional(),
});
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

/* ---------------------------- إعدادات المنشأة ----------------------------- */

/**
 * إعدادات المنشأة.
 *
 * ⚠️ `code` غير قابل للتعديل: مفتاح طبيعي تُشتق منه أكواد الفروع والمراجع.
 * ⚠️ `settings` وعاء jsonb حر في المخطط، لكنه هنا **مغلق على مفاتيح معروفة**:
 *    قبول jsonb عشوائي من العميل يجعل أي حقل مستقبلي قابلًا للحقن قبل تصميمه.
 *    لا يوجد فيه أي إعداد مالي أو تسعيري (P-14 معلّقة).
 */
export const organizationUpdateSchema = z.object({
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200),
  nameEn: z.string().trim().max(200).optional().or(z.literal('')),
  /** بيانات تواصل عامة تظهر على الموقع العام. */
  contactPhone: z.string().trim().max(30).optional().or(z.literal('')),
  contactEmail: z.string().trim().max(320).optional().or(z.literal('')),
  website: z.string().trim().max(300).optional().or(z.literal('')),
  aboutAr: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

/* ------------------------------- النشر ----------------------------------- */

/** فعل النشر منفصل — صلاحية منفصلة ومحفّز يفرضها في قاعدة البيانات. */
export const setPublishSchema = z.object({
  id: z.string().uuid(),
  isPublic: z.boolean(),
});
export type SetPublishInput = z.infer<typeof setPublishSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: statusSchema.optional(),
  isPublic: z.enum(['true', 'false']).optional(),
});
export type ListQueryInput = z.infer<typeof listQuerySchema>;

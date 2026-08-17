import { z } from 'zod';

/**
 * مخططات الخدمات ومقدّمي الخدمة.
 *
 * ⚠️ لا أعمدة سعر — جدول services لا يحتوي أسعارًا (P-14 معلّقة).
 * ⚠️ `isPublic` ليس في مخططات الإنشاء/التعديل — النشر فعل منفصل.
 */

const codeSchema = z
  .string()
  .trim()
  .min(2, 'الكود قصير جدًا')
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, 'الكود يقبل حروفًا لاتينية وأرقامًا وشرطات فقط');

const statusSchema = z.enum(['active', 'inactive']);

/* ------------------------------- الخدمات ---------------------------------- */

export const serviceCreateSchema = z.object({
  code: codeSchema,
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200),
  nameEn: z.string().trim().max(200).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().int().min(5, 'أقل مدة 5 دقائق').max(600).optional(),
  /** null = خدمة مشتركة على مستوى المنشأة (تتطلب نطاق منشأة). */
  branchId: z.string().uuid().nullable().optional(),
});
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;

export const serviceUpdateSchema = serviceCreateSchema.partial().extend({
  id: z.string().uuid(),
  status: statusSchema.optional(),
});
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;

/* --------------------------- مقدّمو الخدمة -------------------------------- */

export const providerCreateSchema = z.object({
  code: codeSchema,
  nameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200),
  nameEn: z.string().trim().max(200).optional().or(z.literal('')),
  specialty: z.string().trim().max(150).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('بريد غير صالح').optional().or(z.literal('')),
  /** null = يعمل على مستوى المنشأة (فروعه تُحدَّد في provider_branches). */
  branchId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;

export const providerUpdateSchema = providerCreateSchema.partial().extend({
  id: z.string().uuid(),
  status: statusSchema.optional(),
});
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;

/* ------------------------------ جداول الربط ------------------------------- */

/**
 * ربط مقدّم الخدمة بالفروع والخدمات.
 *
 * ⚠️ استبدال كامل لا إضافة تفاضلية: الواجهة تعرض الحالة كاملة، وإرسال الفرق
 *    يفتح باب انحراف صامت لو فشل جزء من العملية.
 * ⚠️ قرار العميل المعتمد: **غياب الربط = غير متاح**. تفريغ القائمة يعني أن
 *    المقدّم لن يظهر لأي حجز — وهذا مقصود لا خطأ.
 */
export const providerBranchesSetSchema = z.object({
  providerId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()).max(100),
});
export type ProviderBranchesSetInput = z.infer<typeof providerBranchesSetSchema>;

export const providerServicesSetSchema = z.object({
  providerId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).max(200),
});
export type ProviderServicesSetInput = z.infer<typeof providerServicesSetSchema>;

/** إتاحة الخدمة في الفروع — نفس النمط. */
export const serviceBranchesSetSchema = z.object({
  serviceId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()).max(100),
});
export type ServiceBranchesSetInput = z.infer<typeof serviceBranchesSetSchema>;

/* -------------------------------- مشترك ---------------------------------- */

export const setPublishSchema = z.object({
  id: z.string().uuid(),
  isPublic: z.boolean(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: statusSchema.optional(),
  isPublic: z.enum(['true', 'false']).optional(),
});
export type ListQueryInput = z.infer<typeof listQuerySchema>;

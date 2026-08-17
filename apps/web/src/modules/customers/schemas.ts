import { z } from 'zod';

/**
 * مخططات التحقق لوحدة العملاء.
 *
 * ⚠️ organization_id غير موجود هنا عمدًا: يُشتق من جلسة المستخدم في الخادم.
 *    قبوله من العميل يفتح باب انتحال المنشأة (mass assignment).
 */

const phoneRegex = /^[0-9+\-\s()]{7,20}$/;

export const customerCreateSchema = z.object({
  branchId: z.string().uuid('يجب اختيار فرع صحيح'),
  fullNameAr: z.string().trim().min(2, 'الاسم قصير جدًا').max(200, 'الاسم طويل جدًا'),
  fullNameEn: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().regex(phoneRegex, 'رقم هاتف غير صالح'),
  email: z.string().trim().email('بريد إلكتروني غير صالح').optional().nullable().or(z.literal('')),
  gender: z.enum(['male', 'female']).optional().nullable(),
  code: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial().extend({
  id: z.string().uuid(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
});

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  sortBy: z.enum(['created_at', 'full_name_ar', 'phone']).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type CustomerListInput = z.infer<typeof customerListSchema>;

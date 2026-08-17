import { z } from 'zod';

/**
 * مخططات الحضور والانصراف.
 *
 * ⚠️ لا حقل وقت هنا ولن يوجد: وقت الحضور يأتي من ساعة **الخادم**. قبوله من
 *    العميل يعني أن تغيير ساعة الهاتف يزوّر الحضور.
 * ⚠️ لا حقل مدة ولا مسافة: كلاهما يُحسب في المحرّك من الإحداثيات المُرسلة.
 */

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

export const checkInSchema = z.object({
  branchId: z.string().uuid('اختر الفرع'),
  latitude,
  longitude,
  /** دقة القياس بالأمتار كما يبلّغها المتصفح — للتشخيص لا للقرار. */
  accuracy: z.coerce.number().nonnegative().optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  latitude,
  longitude,
  accuracy: z.coerce.number().nonnegative().optional(),
});
export type CheckOutInput = z.infer<typeof checkOutSchema>;

export const attendanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  branchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD')
    .optional(),
  /** `open` = الجلسات التي لم يُسجَّل لها انصراف. */
  status: z.enum(['open', 'closed']).optional(),
});
export type AttendanceListQueryInput = z.infer<typeof attendanceListQuerySchema>;

export const monthlySummarySchema = z.object({
  /** أول يوم في الشهر المطلوب. */
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD'),
  branchId: z.string().uuid().optional(),
});
export type MonthlySummaryInput = z.infer<typeof monthlySummarySchema>;

/**
 * موقع الفرع — إعداد إداري.
 * ⚠️ نصف القطر بلا قيمة افتراضية: تحديده قرار يخص كل مقر، وفرع بلا نصف قطر
 *    لا يقبل تسجيل حضور إطلاقًا.
 */
export const branchLocationSchema = z.object({
  branchId: z.string().uuid(),
  latitude: latitude.nullable(),
  longitude: longitude.nullable(),
  radiusMeters: z.coerce.number().int().min(20).max(5000).nullable(),
});
export type BranchLocationInput = z.infer<typeof branchLocationSchema>;

/** تصحيح إداري لسجل — لا يُطبَّق على سجل المصحِّح نفسه (تفرضه قاعدة البيانات). */
export const attendanceCorrectionSchema = z.object({
  id: z.string().uuid(),
  checkedOutAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'وقت غير صالح')
    .optional(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type AttendanceCorrectionInput = z.infer<typeof attendanceCorrectionSchema>;

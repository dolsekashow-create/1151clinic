import { z } from 'zod';

/**
 * مخططات التحقق لوحدة الحجوزات.
 *
 * ⚠️ `organizationId` غير موجود عمدًا — يُشتق من الجلسة في الخادم.
 * ⚠️ `durationMinutes` غير موجود عمدًا — يأتي من `services.default_duration_minutes`
 *    ويكتبه محفّز في قاعدة البيانات، فأي قيمة يرسلها العميل تُتجاهَل.
 * ⚠️ لا حقل سعر ولا دفع ولا عربون: لا منطق مالي في هذه الوحدة إطلاقًا.
 */

/** لحظة بصيغة ISO مع منطقة زمنية — لا نقبل وقتًا بلا منطقة. */
const instantSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'تاريخ أو وقت غير صالح');

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD');

export const appointmentCreateSchema = z.object({
  branchId: z.string().uuid('اختر الفرع'),
  customerId: z.string().uuid('اختر العميل'),
  serviceId: z.string().uuid('اختر الخدمة'),
  providerId: z.string().uuid('اختر مقدّم الخدمة'),
  statusId: z.string().uuid('اختر الحالة'),
  scheduledAt: instantSchema,
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

/**
 * التعديل.
 * ⚠️ `branchId` غير قابل للتعديل: نقل حجز بين الفروع يغيّر نطاقه الأمني
 *    ويجعل عميلًا من فرع تابعًا لفرع آخر. الإجراء الصحيح إلغاء وإنشاء جديد.
 */
export const appointmentUpdateSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  scheduledAt: instantSchema.optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateSchema>;

/**
 * تغيير الحالة.
 * ⚠️ لا قواعد انتقال: أي حالة معرّفة في `appointment_statuses` مقبولة.
 *    قائمة الحالات وقواعد الانتقال بينها معلّقة (P-11) ولن تُخترع هنا.
 */
export const appointmentStatusSchema = z.object({
  id: z.string().uuid(),
  statusId: z.string().uuid('اختر الحالة'),
});
export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;

export const availabilityQuerySchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid(),
  providerId: z.string().uuid(),
  date: dateOnlySchema,
});
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

export const appointmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** بحث في اسم العميل أو هاتفه أو رقم الحجز. */
  search: z.string().trim().max(100).optional(),
  branchId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  statusId: z.string().uuid().optional(),
  /** تصفية بيوم واحد بتوقيت الفرع. */
  date: dateOnlySchema.optional(),
});
export type AppointmentListQueryInput = z.infer<typeof appointmentListQuerySchema>;

export const appointmentIdSchema = z.object({ id: z.string().uuid() });

export const bookingOptionsSchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
});

/* ------------------------------ ساعات العمل ------------------------------ */

const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة HH:MM');

/** فترة عمل واحدة. عدة فترات في اليوم = عدة عناصر بنفس `weekday`. */
export const businessHourSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    opensAt: timeSchema,
    closesAt: timeSchema,
    isClosed: z.boolean().default(false),
  })
  .refine((v) => v.isClosed || v.closesAt > v.opensAt, {
    message: 'وقت الإغلاق يجب أن يكون بعد وقت الفتح',
    path: ['closesAt'],
  });

export const businessHoursSetSchema = z.object({
  branchId: z.string().uuid(),
  periods: z.array(businessHourSchema).max(21),
});
export type BusinessHoursSetInput = z.infer<typeof businessHoursSetSchema>;

export const WEEKDAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

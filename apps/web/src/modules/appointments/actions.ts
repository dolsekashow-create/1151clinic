'use server';

import { revalidatePath } from 'next/cache';
import type { Paginated, UUID } from '@erp/types';
import { hasPermission } from '@erp/core';
import { errors } from '@erp/core';
import { defineAction, defineQuery } from '@/shared/lib/action';
import {
  createAppointment,
  getAppointment,
  listAppointments,
  listAvailableSlots,
  listBusinessHours,
  listCustomerOptions,
  listProviderOptions,
  listServiceOptions,
  setAppointmentStatus,
  setBusinessHours,
  updateAppointment,
  type AppointmentRow,
  type BusinessHourRow,
  type Option,
} from './repository';
import {
  appointmentCreateSchema,
  appointmentIdSchema,
  appointmentListQuerySchema,
  appointmentStatusSchema,
  appointmentUpdateSchema,
  availabilityQuerySchema,
  bookingOptionsSchema,
  businessHoursSetSchema,
} from './schemas';

/**
 * أفعال وحدة الحجوزات.
 *
 * ⚠️ الصلاحيات كلها موجودة مسبقًا (البند 5): appointments.view / create /
 *    update / cancel، وساعات العمل تستخدم organizations.branches.update.
 *    لم تُضَف صلاحية واحدة في هذه المرحلة.
 * ⚠️ كل فعل مُدقَّق. الحجز التزام تجاه عميل، ومن غيّره ومتى سؤال يُطرح لاحقًا.
 */

function revalidateAppointments(id?: string): void {
  revalidatePath('/app/appointments');
  if (id) revalidatePath(`/app/appointments/${id}`);
}

/* ------------------------------- القراءة --------------------------------- */

export const listAppointmentsAction = defineQuery<
  ReturnType<typeof appointmentListQuerySchema.parse>,
  Paginated<AppointmentRow>
>({
  permission: 'appointments.view',
  schema: appointmentListQuerySchema,
  handler: async (ctx, input) => {
    const result = await listAppointments(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const getAppointmentAction = defineQuery<{ id: string }, AppointmentRow>({
  permission: 'appointments.view',
  schema: appointmentIdSchema,
  handler: async (ctx, input) => ({ data: await getAppointment(ctx, input.id) }),
});

/** الأوقات المتاحة — تُقرأ من المحرّك، ويُحترم فيها نطاق فروع المستخدم. */
export const listAvailableSlotsAction = defineQuery<
  ReturnType<typeof availabilityQuerySchema.parse>,
  readonly string[]
>({
  permission: 'appointments.view',
  schema: availabilityQuerySchema,
  handler: async (ctx, input) => ({ data: await listAvailableSlots(ctx, input) }),
});

export const listServiceOptionsAction = defineQuery<
  ReturnType<typeof bookingOptionsSchema.parse>,
  readonly Option[]
>({
  permission: 'appointments.view',
  schema: bookingOptionsSchema,
  handler: async (_ctx, input) => ({ data: await listServiceOptions(input.branchId) }),
});

export const listProviderOptionsAction = defineQuery<
  ReturnType<typeof bookingOptionsSchema.parse>,
  readonly Option[]
>({
  permission: 'appointments.view',
  schema: bookingOptionsSchema,
  handler: async (_ctx, input) => ({
    data: input.serviceId ? await listProviderOptions(input.branchId, input.serviceId) : [],
  }),
});

export const searchCustomersAction = defineQuery<
  { branchId: string; search?: string },
  ReadonlyArray<Option & { phone: string | null }>
>({
  permission: 'customers.view',
  schema: bookingOptionsSchema.extend(
    appointmentListQuerySchema.pick({ search: true }).shape,
  ),
  handler: async (_ctx, input) => ({
    data: await listCustomerOptions(input.branchId, input.search ?? ''),
  }),
});

/* -------------------------------- الكتابة -------------------------------- */

export const createAppointmentAction = defineAction<
  ReturnType<typeof appointmentCreateSchema.parse>,
  { id: UUID }
>({
  permission: 'appointments.create',
  schema: appointmentCreateSchema,
  handler: async (ctx, input) => {
    const created = await createAppointment(ctx, input);
    revalidateAppointments();
    return created;
  },
  audit: (_ctx, input, output) => ({
    action: 'appointment.created',
    module: 'appointments',
    entityType: 'appointment',
    entityId: output.id,
    branchId: input.branchId,
    newValues: {
      customerId: input.customerId,
      serviceId: input.serviceId,
      providerId: input.providerId,
      scheduledAt: input.scheduledAt,
    },
  }),
});

export const updateAppointmentAction = defineAction<
  ReturnType<typeof appointmentUpdateSchema.parse>,
  { id: string }
>({
  permission: 'appointments.update',
  schema: appointmentUpdateSchema,
  handler: async (ctx, input) => {
    await updateAppointment(ctx, input);
    revalidateAppointments(input.id);
    return { id: input.id };
  },
  audit: (_ctx, input) => ({
    action: 'appointment.updated',
    module: 'appointments',
    entityType: 'appointment',
    entityId: input.id,
    branchId: null,
    newValues: {
      serviceId: input.serviceId,
      providerId: input.providerId,
      scheduledAt: input.scheduledAt,
    },
  }),
});

/**
 * تغيير حالة الحجز.
 *
 * ⚠️ الصلاحية تُختار حسب تصنيف الحالة الهدف: الانتقال إلى حالة ملغاة يتطلب
 *    `appointments.cancel`، وغيره `appointments.update`. الصلاحيتان موجودتان
 *    في الكتالوج منذ المرحلة 2.
 * ⚠️ **لا قواعد انتقال**: لا نمنع «مكتمل ← مجدول» ولا نفرض تسلسلًا، لأن
 *    قائمة الحالات وقواعدها معلّقة (P-11).
 */
export const setAppointmentStatusAction = defineAction<
  ReturnType<typeof appointmentStatusSchema.parse>,
  { id: string; category: string }
>({
  // الفحص الدقيق داخل المعالج بعد معرفة تصنيف الحالة الهدف
  permission: 'appointments.view',
  schema: appointmentStatusSchema,
  handler: async (ctx, input) => {
    const { listStatusOptions } = await import('./repository');
    const statuses = await listStatusOptions();
    const target = statuses.find((s) => s.id === input.statusId);
    if (!target) throw errors.notFound('appointment_status');

    const required =
      target.category === 'cancelled' ? 'appointments.cancel' : 'appointments.update';
    if (!hasPermission(ctx, required)) throw errors.permissionDenied(required);

    await setAppointmentStatus(ctx, input);
    revalidateAppointments(input.id);
    return { id: input.id, category: target.category };
  },
  audit: (_ctx, input, output) => ({
    action: output.category === 'cancelled' ? 'appointment.cancelled' : 'appointment.status_changed',
    module: 'appointments',
    entityType: 'appointment',
    entityId: input.id,
    branchId: null,
    newValues: { statusId: input.statusId, category: output.category },
  }),
});

/* ------------------------------ ساعات العمل ------------------------------ */

/** ساعات فرع محدد — تُحمَّل عند فتح المحرّر لا مع كل صف في الجدول. */
export const listBusinessHoursAction = defineQuery<{ id: string }, readonly BusinessHourRow[]>({
  permission: 'organizations.branches.view',
  schema: appointmentIdSchema,
  handler: async (_ctx, input) => ({ data: await listBusinessHours(input.id) }),
});

export const setBusinessHoursAction = defineAction<
  ReturnType<typeof businessHoursSetSchema.parse>,
  { branchId: string }
>({
  // ساعات العمل إعداد فرع ⇒ صلاحية تعديل الفروع القائمة، بلا صلاحية جديدة
  permission: 'organizations.branches.update',
  schema: businessHoursSetSchema,
  handler: async (ctx, input) => {
    await setBusinessHours(ctx, input);
    revalidateAppointments();
    revalidatePath('/app/branches');
    return { branchId: input.branchId };
  },
  audit: (_ctx, input) => ({
    action: 'business_hours.updated',
    module: 'organizations',
    entityType: 'branch',
    entityId: input.branchId,
    branchId: input.branchId,
    newValues: { periodCount: input.periods.length },
  }),
});

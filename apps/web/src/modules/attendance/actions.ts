'use server';

import { revalidatePath } from 'next/cache';
import type { Paginated } from '@erp/types';
import { defineAction, defineQuery } from '@/shared/lib/action';
import {
  checkIn,
  checkOut,
  correctAttendance,
  getMonthlySummary,
  getOpenSession,
  listAttendance,
  listBranchLocations,
  setBranchLocation,
  type AttendanceRow,
  type BranchLocationRow,
  type MonthlySummaryRow,
  type OpenSession,
} from './repository';
import {
  attendanceCorrectionSchema,
  attendanceListQuerySchema,
  branchLocationSchema,
  checkInSchema,
  checkOutSchema,
  monthlySummarySchema,
} from './schemas';

/**
 * أفعال الحضور والانصراف.
 *
 * ⚠️ `permission: null` في الدخول والخروج **مقصود**: تسجيل حضور الذات حق كل
 *    موظف بلا استثناء، تمامًا كقراءة ملفه الشخصي. اشتراط صلاحية يعني أن موظفًا
 *    جديدًا لا يستطيع إثبات حضوره حتى يمنحه أحد صلاحية — تعطيل بلا مقابل أمني،
 *    فالحماية الفعلية هي النطاق الجغرافي وانتماء الفرع، وكلاهما في المحرّك.
 *
 * ⚠️ كل عملية حضور مُدقَّقة: من دخل ومتى ومن أي بُعد سؤال يُطرح لاحقًا.
 *    لا تُسجَّل الإحداثيات الخام في التدقيق — المسافة تكفي، والإحداثيات محفوظة
 *    في الجلسة نفسها لمن يملك صلاحية رؤيتها.
 */

function revalidateAttendance(): void {
  revalidatePath('/app/attendance');
  revalidatePath('/app');
}

/* ============================ الدخول والخروج ============================= */

export const checkInAction = defineAction({
  permission: null,
  schema: checkInSchema,
  handler: async (ctx, input) => {
    const result = await checkIn(ctx, input);
    revalidateAttendance();
    return result;
  },
  audit: (_ctx, input, output) => ({
    action: 'attendance.checked_in',
    module: 'attendance',
    entityType: 'attendance_session',
    entityId: output.sessionId,
    branchId: input.branchId,
    // ⚠️ لا إحداثيات خام في التدقيق — المسافة هي المعلومة المفيدة
    newValues: { distanceMeters: output.distanceMeters },
  }),
});

export const checkOutAction = defineAction({
  permission: null,
  schema: checkOutSchema,
  handler: async (ctx, input) => {
    const result = await checkOut(ctx, input);
    revalidateAttendance();
    return result;
  },
  audit: (_ctx, _input, output) => ({
    action: 'attendance.checked_out',
    module: 'attendance',
    entityType: 'attendance_session',
    entityId: null,
    branchId: null,
    newValues: { durationMinutes: output.durationMinutes, distanceMeters: output.distanceMeters },
  }),
});

/* ================================ القراءة ================================ */

/** الجلسة المفتوحة للمستخدم الحالي — بلا صلاحية: سجلّه هو. */
export const getOpenSessionAction = defineQuery<Record<string, never>, OpenSession | null>({
  permission: null,
  schema: monthlySummarySchema.partial().pick({}).default({}),
  handler: async (ctx) => ({ data: await getOpenSession(ctx) }),
});

export const listAttendanceAction = defineQuery<
  ReturnType<typeof attendanceListQuerySchema.parse>,
  Paginated<AttendanceRow>
>({
  // ⚠️ بلا صلاحية: RLS تُرجع سجل المستخدم نفسه لمن لا يملك attendance.view،
  //    وسجلات فروعه لمن يملكها. الفلترة الأمنية في المحرّك لا هنا.
  permission: null,
  schema: attendanceListQuerySchema,
  handler: async (ctx, input) => {
    const result = await listAttendance(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const getMonthlySummaryAction = defineQuery<
  ReturnType<typeof monthlySummarySchema.parse>,
  readonly MonthlySummaryRow[]
>({
  permission: 'attendance.view',
  schema: monthlySummarySchema,
  handler: async (ctx, input) => ({ data: await getMonthlySummary(ctx, input) }),
});

export const listBranchLocationsAction = defineQuery<
  Record<string, never>,
  readonly BranchLocationRow[]
>({
  permission: 'organizations.branches.view',
  schema: monthlySummarySchema.partial().pick({}).default({}),
  handler: async () => ({ data: await listBranchLocations() }),
});

/* ============================== الإعداد والتصحيح ========================== */

export const setBranchLocationAction = defineAction({
  // موقع الفرع إعداد فرع ⇒ صلاحية تعديل الفروع القائمة، بلا صلاحية جديدة
  permission: 'organizations.branches.update',
  schema: branchLocationSchema,
  handler: async (ctx, input) => {
    await setBranchLocation(ctx, input);
    revalidateAttendance();
    revalidatePath('/app/branches');
    return { branchId: input.branchId };
  },
  audit: (_ctx, input) => ({
    action: 'branch.location_updated',
    module: 'organizations',
    entityType: 'branch',
    entityId: input.branchId,
    branchId: input.branchId,
    newValues: { radiusMeters: input.radiusMeters, configured: input.latitude !== null },
  }),
});

export const correctAttendanceAction = defineAction({
  permission: 'attendance.manage',
  schema: attendanceCorrectionSchema,
  handler: async (ctx, input) => {
    await correctAttendance(ctx, input);
    revalidateAttendance();
    return { id: input.id };
  },
  audit: (_ctx, input) => ({
    action: 'attendance.corrected',
    module: 'attendance',
    entityType: 'attendance_session',
    entityId: input.id,
    branchId: null,
    newValues: { checkedOutAt: input.checkedOutAt, hasNotes: Boolean(input.notes) },
  }),
});

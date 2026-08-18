'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { errors } from '@erp/core';
import { defineAction } from '@/shared/lib/action';
import { createClient } from '@/infrastructure/supabase/server';

/**
 * الحذف الناعم الموحّد لكل الكيانات الإدارية.
 *
 * ⚠️ فعل واحد لا سبعة: المنطق متطابق تمامًا (فحص التوابع ثم ضبط `deleted_at`)،
 *    وتكراره سبع مرات يعني سبعة أماكن تنسى إحداها فحص التوابع لاحقًا.
 *    الاختلاف الوحيد بين الكيانات هو **الصلاحية**، وهي معطى لا منطق.
 *
 * ⚠️ الصلاحية تُفحص مرتين عمدًا: هنا لرسالة مبكرة مفهومة، وفي حارس قاعدة
 *    البيانات كحكم نهائي لا يُتجاوَز بنداء مباشر على PostgREST.
 */

/** خريطة الكيان → صلاحيته ومسمّاه ومساراته. مصدر واحد للحقيقة. */
const ENTITIES = {
  branch: {
    permission: 'organizations.branches.delete',
    label: 'الفرع',
    paths: ['/app/branches', '/branches', '/contact', '/'],
  },
  department: {
    permission: 'organizations.departments.delete',
    label: 'القسم',
    paths: ['/app/departments'],
  },
  service: {
    permission: 'services.delete',
    label: 'الخدمة',
    paths: ['/app/services', '/services', '/'],
  },
  provider: {
    permission: 'services.providers.delete',
    label: 'مقدّم الخدمة',
    paths: ['/app/providers', '/providers', '/'],
  },
  customer: {
    permission: 'customers.delete',
    label: 'العميل',
    paths: ['/app/customers'],
  },
  appointment: {
    permission: 'appointments.delete',
    label: 'الحجز',
    paths: ['/app/appointments'],
  },
  user: {
    permission: 'identity.users.delete',
    label: 'المستخدم',
    paths: ['/app/users'],
  },
} as const;

export type ArchivableEntity = keyof typeof ENTITIES;

const archiveSchema = z.object({
  entity: z.enum(['branch', 'department', 'service', 'provider', 'customer', 'appointment', 'user']),
  id: z.string().uuid(),
});

/**
 * ⚠️ `permission: null` هنا لأن الصلاحية تختلف بحسب الكيان ولا يمكن تثبيتها
 *    في الغلاف. تُفحص أول سطر في المعالج — قبل أي عمل.
 */
export const archiveRecordAction = defineAction({
  permission: null,
  schema: archiveSchema,
  handler: async (ctx, input) => {
    const entity = ENTITIES[input.entity];

    if (!ctx.permissions.includes(entity.permission)) {
      throw errors.permissionDenied(entity.permission);
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc('archive_record', {
      p_entity: input.entity,
      p_id: input.id,
    });

    if (error) throw translateArchiveError(error);

    for (const path of entity.paths) revalidatePath(path);
    return { id: input.id, entity: input.entity };
  },
  audit: (_ctx, input) => ({
    action: `${input.entity}.archived`,
    module: 'organizations',
    entityType: input.entity,
    entityId: input.id,
    branchId: null,
    newValues: { softDeleted: true },
  }),
});

/** عدد التوابع — يُعرض قبل التأكيد ليعرف المستخدم أثر الحذف. */
export const countDependentsAction = defineAction({
  permission: null,
  schema: archiveSchema,
  handler: async (_ctx, input) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('count_dependents', {
      p_entity: input.entity,
      p_id: input.id,
    });
    if (error) throw errors.internal(error);

    return (data ?? [])
      .filter((row: { total: number }) => Number(row.total) > 0)
      .map((row: { label: string; total: number }) => ({
        label: row.label,
        total: Number(row.total),
      }));
  },
});

/**
 * ⚠️ رسائل دالة الأرشفة مكتوبة للمستخدم النهائي وتحوي أعداد التوابع، فتُمرَّر
 *    كما هي. ما عداها يُعمَّم — ممنوع تسريب أسماء قيود أو جداول.
 */
function translateArchiveError(error: { code?: string; message?: string }): Error {
  if (error.code === '22023' || error.code === 'P0001') {
    return errors.conflict(error.message ?? 'تعذّر الحذف');
  }
  if (error.code === '42501') {
    return errors.operationDenied(error.message ?? 'لا تملك صلاحية الحذف');
  }
  if (error.code === '23503') {
    return errors.conflict('لا يمكن الحذف — يوجد سجلات مرتبطة بهذا العنصر');
  }
  return errors.internal(error);
}

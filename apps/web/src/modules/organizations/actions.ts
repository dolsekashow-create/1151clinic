'use server';

import { revalidatePath } from 'next/cache';
import type { Paginated } from '@erp/types';
import { defineAction, defineQuery } from '@/shared/lib/action';
import { z } from 'zod';
import {
  createBranch,
  createDepartment,
  getOrganization,
  listBranches,
  listDepartments,
  setBranchPublish,
  setOrganizationPublish,
  updateBranch,
  updateDepartment,
  updateOrganization,
  type BranchRow,
  type DepartmentRow,
  type OrganizationRow,
} from './repository';
import {
  branchCreateSchema,
  branchUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  listQuerySchema,
  organizationUpdateSchema,
  setPublishSchema,
} from './schemas';

/** استعلام بلا مدخلات — نفس النمط في بقية الوحدات. */
const emptySchema = z.object({}).default({});

/**
 * أفعال وحدة التنظيم — كلها عبر defineAction:
 * مصادقة → صلاحية → تحقق → تنفيذ → تدقيق.
 *
 * ⚠️ النشر فعل منفصل بصلاحية `organizations.branches.publish`، ويُفرض أيضًا
 *    بمحفّز في قاعدة البيانات. فصل الصلاحية في الواجهة وحدها لا يكفي.
 */

/* -------------------------------- الفروع ---------------------------------- */

export const listBranchesAction = defineQuery<
  ReturnType<typeof listQuerySchema.parse>,
  Paginated<BranchRow>
>({
  permission: 'organizations.branches.view',
  schema: listQuerySchema,
  handler: async (ctx, input) => {
    const result = await listBranches(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const createBranchAction = defineAction({
  permission: 'organizations.branches.create',
  schema: branchCreateSchema,
  handler: async (ctx, input) => {
    const branch = await createBranch(ctx, input);
    revalidatePath('/app/branches');
    return branch;
  },
  audit: (_ctx, _input, output) => ({
    action: 'branch.created',
    module: 'organizations',
    entityType: 'branch',
    entityId: output.id,
    branchId: output.id,
    newValues: { code: output.code, nameAr: output.nameAr, city: output.city },
  }),
});

export const updateBranchAction = defineAction({
  permission: 'organizations.branches.update',
  schema: branchUpdateSchema,
  handler: async (ctx, input) => {
    const branch = await updateBranch(ctx, input);
    revalidatePath('/app/branches');
    return branch;
  },
  audit: (_ctx, input, output) => ({
    action: 'branch.updated',
    module: 'organizations',
    entityType: 'branch',
    entityId: output.id,
    branchId: output.id,
    newValues: { ...input, id: undefined },
  }),
});

/* ---------------------------- إعدادات المنشأة ----------------------------- */

export const getOrganizationAction = defineQuery<Record<string, never>, OrganizationRow>({
  permission: 'organizations.organization.view',
  schema: emptySchema,
  handler: async (ctx) => ({ data: await getOrganization(ctx) }),
});

export const updateOrganizationAction = defineAction({
  permission: 'organizations.organization.update',
  schema: organizationUpdateSchema,
  handler: async (ctx, input) => {
    const organization = await updateOrganization(ctx, input);
    revalidatePath('/app/organization');
    // بيانات المنشأة تظهر على الموقع العام ⇒ نُبطل ذاكرته أيضًا
    revalidatePath('/');
    revalidatePath('/contact');
    return organization;
  },
  audit: (_ctx, input, output) => ({
    action: 'organization.updated',
    module: 'organizations',
    entityType: 'organization',
    entityId: output.id,
    branchId: null,
    newValues: { nameAr: input.nameAr, nameEn: input.nameEn },
  }),
});

/**
 * البوابة العليا للموقع العام.
 * ⚠️ إخفاء المنشأة يُخفي كل الفروع والخدمات والأطباء دفعةً واحدة.
 */
export const setOrganizationPublishAction = defineAction({
  permission: 'organizations.organization.publish',
  schema: setPublishSchema.pick({ isPublic: true }),
  handler: async (ctx, input) => {
    const result = await setOrganizationPublish(ctx, input.isPublic);
    revalidatePath('/app/organization');
    revalidatePath('/');
    revalidatePath('/branches');
    revalidatePath('/services');
    revalidatePath('/providers');
    revalidatePath('/contact');
    return result;
  },
  audit: (ctx, input) => ({
    action: input.isPublic ? 'organization.published' : 'organization.unpublished',
    module: 'organizations',
    entityType: 'organization',
    entityId: ctx.organizationId,
    branchId: null,
    newValues: { isPublic: input.isPublic },
  }),
});

export const setBranchPublishAction = defineAction({
  permission: 'organizations.branches.publish',
  schema: setPublishSchema,
  handler: async (ctx, input) => {
    const branch = await setBranchPublish(ctx, input.id, input.isPublic);
    revalidatePath('/app/branches');
    // كل سطح عام يعرض الفروع ⇒ نُبطل ذاكرته. `/contact` يشتق بياناته من الفروع.
    revalidatePath('/branches');
    revalidatePath('/contact');
    revalidatePath('/');
    return branch;
  },
  audit: (_ctx, input, output) => ({
    action: input.isPublic ? 'branch.published' : 'branch.unpublished',
    module: 'organizations',
    entityType: 'branch',
    entityId: output.id,
    branchId: output.id,
    newValues: { isPublic: input.isPublic, code: output.code },
  }),
});

/* -------------------------------- الأقسام --------------------------------- */

export const listDepartmentsAction = defineQuery<
  ReturnType<typeof listQuerySchema.parse>,
  Paginated<DepartmentRow>
>({
  permission: 'organizations.departments.view',
  schema: listQuerySchema,
  handler: async (ctx, input) => {
    const result = await listDepartments(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const createDepartmentAction = defineAction({
  permission: 'organizations.departments.manage',
  schema: departmentCreateSchema,
  handler: async (ctx, input) => {
    const department = await createDepartment(ctx, input);
    revalidatePath('/app/departments');
    return department;
  },
  audit: (_ctx, input, output) => ({
    action: 'department.created',
    module: 'organizations',
    entityType: 'department',
    entityId: output.id,
    branchId: input.branchId ?? null,
    newValues: { code: output.code, nameAr: output.nameAr },
  }),
});

export const updateDepartmentAction = defineAction({
  permission: 'organizations.departments.manage',
  schema: departmentUpdateSchema,
  handler: async (ctx, input) => {
    const department = await updateDepartment(ctx, input);
    revalidatePath('/app/departments');
    return department;
  },
  audit: (_ctx, input, output) => ({
    action: 'department.updated',
    module: 'organizations',
    entityType: 'department',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { ...input, id: undefined },
  }),
});

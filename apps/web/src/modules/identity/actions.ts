'use server';

import { revalidatePath } from 'next/cache';
import type { Paginated } from '@erp/types';
import { defineAction, defineQuery } from '@/shared/lib/action';
import {
  createProviderAccount,
  createRole,
  createUser,
  getRolePermissionKeys,
  getUser,
  getUserPermissions,
  listRoles,
  listUsers,
  setUserAssignment,
  setUserStatus,
  updateRole,
  updateUser,
  type CreatedUser,
  type RoleRow,
  type UserRow,
} from './repository';
import {
  providerAccountSchema,
  roleCreateSchema,
  roleUpdateSchema,
  userAssignmentSchema,
  userCreateSchema,
  userIdSchema,
  userListQuerySchema,
  userStatusSchema,
  userUpdateSchema,
} from './schemas';

/**
 * أفعال وحدة الهوية.
 *
 * ⚠️ كل فعل يُسجَّل في التدقيق. عمليات الهوية هي العمليات التي يُسأل عنها
 *    لاحقًا («من منح هذا الحساب هذا الدور؟») فالتدقيق ليس اختياريًا فيها.
 * ⚠️ لا تُسجَّل كلمات مرور ولا روابط استعادة في التدقيق — الحقول المُسجّلة
 *    محدَّدة صراحةً في كل فعل، بلا نشر تلقائي للمدخلات.
 */

function revalidateUsers(id?: string): void {
  revalidatePath('/app/users');
  if (id) revalidatePath(`/app/users/${id}`);
}

/* -------------------------------- القراءة -------------------------------- */

export const listUsersAction = defineQuery<
  ReturnType<typeof userListQuerySchema.parse>,
  Paginated<UserRow>
>({
  permission: 'identity.users.view',
  schema: userListQuerySchema,
  handler: async (ctx, input) => {
    const result = await listUsers(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const getUserAction = defineQuery<{ id: string }, UserRow>({
  permission: 'identity.users.view',
  schema: userIdSchema,
  handler: async (ctx, input) => ({ data: await getUser(ctx, input.id) }),
});

export const getUserPermissionsAction = defineQuery<{ id: string }, readonly string[]>({
  permission: 'identity.users.view',
  schema: userIdSchema,
  handler: async (_ctx, input) => ({ data: await getUserPermissions(input.id) }),
});

export const listRolesAction = defineQuery<Record<string, never>, readonly RoleRow[]>({
  permission: 'identity.roles.view',
  schema: userListQuerySchema.pick({}).default({}),
  handler: async () => ({ data: await listRoles() }),
});

/** صلاحيات دور محدد — تُحمَّل عند فتح محرّر الدور لا مع كل صف. */
export const getRolePermissionsAction = defineQuery<{ id: string }, readonly string[]>({
  permission: 'identity.roles.view',
  schema: userIdSchema,
  handler: async (_ctx, input) => ({ data: await getRolePermissionKeys(input.id) }),
});

/* ------------------------------ إنشاء مستخدم ------------------------------ */

export const createUserAction = defineAction<
  ReturnType<typeof userCreateSchema.parse>,
  CreatedUser
>({
  permission: 'identity.users.create',
  schema: userCreateSchema,
  handler: async (ctx, input) => {
    const created = await createUser(ctx, input);
    revalidateUsers();
    return created;
  },
  audit: (_ctx, input, output) => ({
    action: 'user.created',
    module: 'identity',
    entityType: 'user',
    entityId: output.id,
    branchId: input.branchIds[0] ?? null,
    // ⚠️ لا كلمة مرور ولا رابط. البريد يُسجَّل لأنه معرّف الحساب وضروري للتدقيق.
    newValues: {
      email: input.email,
      roleId: input.roleId,
      scope: input.scope,
      branchCount: input.branchIds.length,
      linkedProvider: Boolean(input.providerId),
    },
  }),
});

export const createProviderAccountAction = defineAction<
  ReturnType<typeof providerAccountSchema.parse>,
  CreatedUser
>({
  permission: 'identity.users.create',
  schema: providerAccountSchema,
  handler: async (ctx, input) => {
    const created = await createProviderAccount(ctx, input);
    revalidateUsers();
    revalidatePath('/app/providers');
    return created;
  },
  audit: (_ctx, input, output) => ({
    action: 'service_provider.account_created',
    module: 'identity',
    entityType: 'user',
    entityId: output.id,
    branchId: input.branchIds[0] ?? null,
    newValues: { providerId: input.providerId, email: input.email, roleId: input.roleId },
  }),
});

/* ------------------------------ تعديل مستخدم ------------------------------ */

export const updateUserAction = defineAction<
  ReturnType<typeof userUpdateSchema.parse>,
  UserRow
>({
  permission: 'identity.users.update',
  schema: userUpdateSchema,
  handler: async (ctx, input) => {
    const user = await updateUser(ctx, input);
    revalidateUsers(input.id);
    return user;
  },
  audit: (_ctx, input, output) => ({
    action: 'user.updated',
    module: 'identity',
    entityType: 'user',
    entityId: output.id,
    branchId: null,
    newValues: {
      fullNameAr: input.fullNameAr,
      jobTitle: input.jobTitle,
      employeeCode: input.employeeCode,
    },
  }),
});

/** الإيقاف فعل مستقل: أثره أمني ويجب أن يظهر في التدقيق بمفرده. */
export const setUserStatusAction = defineAction<
  ReturnType<typeof userStatusSchema.parse>,
  UserRow
>({
  permission: 'identity.users.update',
  schema: userStatusSchema,
  handler: async (ctx, input) => {
    const user = await setUserStatus(ctx, input);
    revalidateUsers(input.id);
    return user;
  },
  audit: (_ctx, input, output) => ({
    action: input.status === 'suspended' ? 'user.suspended' : 'user.reactivated',
    module: 'identity',
    entityType: 'user',
    entityId: output.id,
    branchId: null,
    newValues: { status: input.status },
  }),
});

/**
 * تغيير الدور والفروع.
 *
 * الصلاحية المعلنة هنا `identity.roles.manage`، والمحرّك يشترط إضافةً
 * `identity.branches.assign` — لأن العملية تمسّ الاثنين. الفحص المزدوج مقصود:
 * الغلاف يرفض مبكرًا برسالة مفهومة، والمحرّك هو الحكم النهائي.
 */
export const setUserAssignmentAction = defineAction<
  ReturnType<typeof userAssignmentSchema.parse>,
  { id: string }
>({
  permission: 'identity.roles.manage',
  schema: userAssignmentSchema,
  handler: async (ctx, input) => {
    await setUserAssignment(ctx, input);
    revalidateUsers(input.id);
    return { id: input.id };
  },
  audit: (_ctx, input) => ({
    action: 'user.assignment_changed',
    module: 'identity',
    entityType: 'user',
    entityId: input.id,
    branchId: input.branchIds[0] ?? null,
    newValues: { roleId: input.roleId, scope: input.scope, branchIds: input.branchIds },
  }),
});

/* -------------------------------- الأدوار -------------------------------- */

export const createRoleAction = defineAction<
  ReturnType<typeof roleCreateSchema.parse>,
  RoleRow
>({
  permission: 'identity.roles.manage',
  schema: roleCreateSchema,
  handler: async (ctx, input) => {
    const role = await createRole(ctx, input);
    revalidatePath('/app/roles');
    return role;
  },
  audit: (_ctx, input, output) => ({
    action: 'role.created',
    module: 'identity',
    entityType: 'role',
    entityId: output.id,
    branchId: null,
    newValues: { key: input.key, nameAr: input.nameAr, permissionCount: input.permissionKeys.length },
  }),
});

export const updateRoleAction = defineAction<
  ReturnType<typeof roleUpdateSchema.parse>,
  { id: string }
>({
  permission: 'identity.roles.manage',
  schema: roleUpdateSchema,
  handler: async (ctx, input) => {
    await updateRole(ctx, input);
    revalidatePath('/app/roles');
    return { id: input.id };
  },
  audit: (_ctx, input) => ({
    action: 'role.updated',
    module: 'identity',
    entityType: 'role',
    entityId: input.id,
    branchId: null,
    newValues: {
      nameAr: input.nameAr,
      permissionCount: input.permissionKeys?.length,
    },
  }),
});

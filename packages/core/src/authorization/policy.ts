import type { AuthContext, UUID } from '@erp/types';
import { errors } from '../errors';

/**
 * دوال التخويل — **دوال خالصة** بلا أي وصول لقاعدة البيانات أو الشبكة.
 *
 * ⚠️ هذه الطبقة تُنتج رسائل خطأ واضحة وتُسجَّل في التدقيق،
 *    لكنها **ليست** الضامن الأمني. الضامن هو RLS في PostgreSQL.
 *    راجع docs/SECURITY.md §2.
 */

export function isActive(ctx: AuthContext): boolean {
  return ctx.status === 'active';
}

export function hasPermission(ctx: AuthContext, permission: string): boolean {
  if (!isActive(ctx)) return false;
  return ctx.permissions.includes(permission);
}

export function hasAnyPermission(ctx: AuthContext, permissions: readonly string[]): boolean {
  return permissions.some((p) => hasPermission(ctx, p));
}

export function hasAllPermissions(ctx: AuthContext, permissions: readonly string[]): boolean {
  return permissions.every((p) => hasPermission(ctx, p));
}

/**
 * وصول المستخدم لفرع محدد.
 * `branchId === null` يعني سجلًا على مستوى المنشأة — يتطلب نطاق منشأة.
 */
export function canAccessBranch(ctx: AuthContext, branchId: UUID | null): boolean {
  if (!isActive(ctx)) return false;
  if (ctx.hasOrganizationScope) return true;
  if (branchId === null) return false;
  return ctx.branchIds.includes(branchId);
}

export function canAccessOrganization(ctx: AuthContext, organizationId: UUID): boolean {
  return isActive(ctx) && ctx.organizationId === organizationId;
}

/* -------------------------------------------------------------------------- */
/*  حُرّاس (Guards) — ترمي AppError بدل إرجاع boolean                            */
/* -------------------------------------------------------------------------- */

export function requirePermission(ctx: AuthContext, permission: string): void {
  if (!hasPermission(ctx, permission)) {
    throw errors.permissionDenied(permission);
  }
}

export function requireBranchAccess(ctx: AuthContext, branchId: UUID | null): void {
  if (!canAccessBranch(ctx, branchId)) {
    throw errors.branchAccessDenied(branchId ?? 'organization-level');
  }
}

export function requireOrganization(ctx: AuthContext, organizationId: UUID): void {
  if (!canAccessOrganization(ctx, organizationId)) {
    throw errors.notFound('organization');
  }
}

/**
 * يُرجع قائمة الفروع المسموح الاستعلام عنها.
 * `null` = كل فروع المنشأة (نطاق منشأة) ⇒ لا تُضاف فلترة فرع للاستعلام.
 */
export function resolveBranchFilter(
  ctx: AuthContext,
  requestedBranchId?: UUID | null,
): readonly UUID[] | null {
  if (requestedBranchId) {
    requireBranchAccess(ctx, requestedBranchId);
    return [requestedBranchId];
  }
  if (ctx.hasOrganizationScope) return null;
  return ctx.branchIds;
}

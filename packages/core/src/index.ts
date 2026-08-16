/**
 * @erp/core — طبقة المجال والتطبيق.
 *
 * ⚠️ قاعدة معمارية مُلزِمة:
 *    هذه الحزمة **ممنوع** أن تستورد من `next`، `react`، `@supabase/*`،
 *    أو أي شيء يعرف HTTP أو الواجهة. TypeScript خالص فقط.
 *    هذا ما يجعل استخراج Backend مستقل مستقبلًا ممكنًا بلا إعادة كتابة.
 *    راجع docs/ARCHITECTURE.md §2.
 */

export { AppError, errors } from './errors';
export { ok, fail, toActionResult } from './result';

export {
  PERMISSIONS,
  INITIAL_ROLES,
  isKnownPermission,
  permissionsByModule,
  type PermissionDefinition,
  type PermissionKey,
  type RoleSeed,
} from './permissions/catalog';

export {
  isActive,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  canAccessBranch,
  canAccessOrganization,
  requirePermission,
  requireBranchAccess,
  requireOrganization,
  resolveBranchFilter,
} from './authorization/policy';

export {
  PENDING_RULES,
  getPendingRule,
  pendingRulesByModule,
  businessRulePending,
  type PendingRule,
} from './pending/registry';

export {
  InMemoryEventBus,
  type DomainEvent,
  type DomainEventHandler,
} from './events/domain-event';

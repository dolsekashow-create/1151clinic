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

export {
  DEFAULT_RETRY_POLICY,
  nextRetryDelayMs,
  shouldRetry,
  type NotificationChannel,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationStatus,
  type NotificationTemplate,
  type ProviderSendResult,
  type RetryPolicy,
} from './notifications/types';
export {
  NotificationService,
  ProviderRegistry,
  renderTemplate,
  type DeliveryAttempt,
  type DeliveryOutcome,
} from './notifications/service';

export {
  ReportRegistry,
  toCsv,
  type ExportFormat,
  type ReportColumnDefinition,
  type ReportDefinition,
  type ReportExporter,
  type ReportFilterDefinition,
  type ReportFilterType,
  type ReportQuery,
  type ReportResult,
} from './reports/types';

export type {
  EntityMapping,
  ImportAdapter,
  ImportResult,
  IntegrationDirection,
  LegacyRecordRef,
  MappingStore,
  SyncSchedule,
} from './integration/types';

export {
  InMemoryRateLimiter,
  NoopRateLimiter,
  RATE_LIMITS,
  assertWithinLimit,
  type RateLimitKind,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimiter,
} from './rate-limit/types';

export {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  SIGNED_URL_TTL_SECONDS,
  buildStoragePath,
  canAccessFile,
  requireFileAccess,
  validateUpload,
  type FileDescriptor,
} from './storage/policy';

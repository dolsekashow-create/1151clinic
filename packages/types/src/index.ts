/**
 * @erp/types — أنواع مشتركة بين كل الطبقات.
 *
 * قاعدة: هذه الحزمة **أنواع فقط**، بلا أي كود تشغيلي وبلا اعتماديات خارجية.
 * أي منطق ينتمي إلى @erp/core.
 */

export type { Database, Json } from './database.types';

/* -------------------------------------------------------------------------- */
/*  أساسيات                                                                    */
/* -------------------------------------------------------------------------- */

/** معرّف UUID (v4) — المفتاح الأساسي لكل الكيانات. */
export type UUID = string;

/** تاريخ/وقت بصيغة ISO-8601 بتوقيت UTC. */
export type ISODateTime = string;

/** رمز عملة ISO-4217 (مثل: SAR, EGP, USD). */
export type CurrencyCode = string;

/**
 * مبلغ مالي.
 * ⚠️ يُخزَّن في قاعدة البيانات كـ numeric(18,4) ويُنقل كنص لتفادي فقد الدقة
 *    في IEEE-754. لا تُجرِ حسابات مالية على `number` مباشرة.
 */
export interface Money {
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/* -------------------------------------------------------------------------- */
/*  سياق المستخدم والنطاق                                                       */
/* -------------------------------------------------------------------------- */

export type AccountStatus = 'active' | 'inactive' | 'suspended';

/** نطاق الدور: على مستوى المنشأة كلها أو على فروع محددة. */
export type RoleScope = 'organization' | 'branch';

/**
 * سياق الطلب الموثوق — يُبنى في الخادم من الجلسة فقط.
 * ⚠️ ممنوع بناؤه من مدخلات العميل.
 */
export interface AuthContext {
  readonly userId: UUID;
  readonly organizationId: UUID;
  readonly email: string | null;
  readonly status: AccountStatus;
  /** الفروع التي يملك المستخدم وصولًا إليها. فارغ = نطاق منشأة (كل الفروع). */
  readonly branchIds: readonly UUID[];
  readonly hasOrganizationScope: boolean;
  readonly permissions: readonly string[];
}

/* -------------------------------------------------------------------------- */
/*  الترقيم والاستعلام                                                          */
/* -------------------------------------------------------------------------- */

export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginationMeta extends PaginationParams {
  readonly total: number;
  readonly totalPages: number;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly meta: PaginationMeta;
}

export type SortDirection = 'asc' | 'desc';

export interface ListQuery extends Partial<PaginationParams> {
  readonly search?: string;
  readonly sortBy?: string;
  readonly sortDir?: SortDirection;
  readonly branchId?: UUID;
  readonly from?: ISODateTime;
  readonly to?: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/*  غلاف الاستجابة الموحّد                                                       */
/* -------------------------------------------------------------------------- */

/** أكواد الأخطاء المعتمدة — راجع docs/API.md §3. */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  /** الجلسة صالحة لكن الإدارة أوقفت الحساب — سبب مختلف عن عدم المصادقة. */
  | 'ACCOUNT_SUSPENDED'
  | 'PERMISSION_DENIED'
  | 'BRANCH_ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'BUSINESS_RULE_PENDING'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorShape {
  readonly code: AppErrorCode;
  /** رسالة بالعربية موجّهة للمستخدم — بلا تفاصيل تقنية. */
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type ActionResult<T> =
  | { readonly success: true; readonly data: T; readonly meta?: PaginationMeta }
  | { readonly success: false; readonly error: ApiErrorShape };

/* -------------------------------------------------------------------------- */
/*  الوحدات والتدقيق                                                            */
/* -------------------------------------------------------------------------- */

/** الوحدات المنطقية للنظام — تُستخدم في الصلاحيات وسجل التدقيق. */
export type ModuleKey =
  | 'auth'
  | 'identity'
  | 'organizations'
  | 'customers'
  | 'services'
  | 'appointments'
  | 'attendance'
  | 'inventory'
  | 'purchasing'
  | 'finance'
  | 'notifications'
  | 'reports'
  | 'audit'
  | 'settings';

export interface AuditRecordInput {
  readonly action: string;
  readonly module: ModuleKey;
  readonly entityType: string;
  readonly entityId: UUID | null;
  readonly branchId: UUID | null;
  readonly oldValues?: Record<string, unknown> | null;
  readonly newValues?: Record<string, unknown> | null;
}

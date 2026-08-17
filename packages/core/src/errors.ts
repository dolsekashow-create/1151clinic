import type { AppErrorCode, ApiErrorShape } from '@erp/types';

/**
 * خطأ التطبيق الموحّد.
 *
 * قاعدة: كل خطأ يعبر حدود النظام يجب أن يكون AppError.
 * الاستثناءات غير المتوقعة تُحوَّل إلى INTERNAL_ERROR وتُسجَّل بلا كشف تفاصيلها للمستخدم.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  /** رسالة موجّهة للمستخدم بالعربية. */
  readonly userMessage: string;

  constructor(params: {
    code: AppErrorCode;
    userMessage: string;
    httpStatus: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(`${params.code}: ${params.userMessage}`, { cause: params.cause });
    this.name = 'AppError';
    this.code = params.code;
    this.userMessage = params.userMessage;
    this.httpStatus = params.httpStatus;
    this.details = params.details;
  }

  toShape(): ApiErrorShape {
    return this.details !== undefined
      ? { code: this.code, message: this.userMessage, details: this.details }
      : { code: this.code, message: this.userMessage };
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}

export const errors = {
  unauthenticated: (): AppError =>
    new AppError({
      code: 'UNAUTHENTICATED',
      userMessage: 'يجب تسجيل الدخول للمتابعة',
      httpStatus: 401,
    }),

  /**
   * الحساب موقوف أو غير نشط.
   * منفصل عن `unauthenticated` لأن السبب مختلف: الجلسة صالحة والحساب موجود،
   * لكن الإدارة أوقفته — والمستخدم يستحق رسالة تقول ذلك.
   */
  accountSuspended: (): AppError =>
    new AppError({
      code: 'ACCOUNT_SUSPENDED',
      userMessage: 'هذا الحساب موقوف. راجع إدارة النظام.',
      httpStatus: 403,
    }),

  permissionDenied: (required: string): AppError =>
    new AppError({
      code: 'PERMISSION_DENIED',
      userMessage: 'لا تملك صلاحية تنفيذ هذا الإجراء',
      httpStatus: 403,
      details: { required },
    }),

  branchAccessDenied: (branchId: string): AppError =>
    new AppError({
      code: 'BRANCH_ACCESS_DENIED',
      userMessage: 'لا تملك صلاحية الوصول إلى بيانات هذا الفرع',
      httpStatus: 403,
      details: { branchId },
    }),

  /**
   * رفض بصلاحية أو نطاق مع **رسالة محددة** من قاعدة البيانات.
   *
   * ⚠️ يُستخدم فقط لرسائل الحُرّاس المكتوبة للمستخدم النهائي («لا يمكنك منح دور
   *    يحتوي صلاحيات لا تملكها»). لا يُمرَّر إليه نص خطأ خام من المحرّك، لأن ذلك
   *    يكشف أسماء جداول وقيودًا. للرفض العام استخدم `permissionDenied`.
   */
  operationDenied: (userMessage: string): AppError =>
    new AppError({
      code: 'PERMISSION_DENIED',
      userMessage,
      httpStatus: 403,
    }),

  notFound: (entity: string): AppError =>
    new AppError({
      code: 'NOT_FOUND',
      userMessage: 'العنصر المطلوب غير موجود',
      httpStatus: 404,
      details: { entity },
    }),

  validation: (fieldErrors: Record<string, string[]>): AppError =>
    new AppError({
      code: 'VALIDATION_ERROR',
      userMessage: 'البيانات المُدخلة غير صحيحة',
      httpStatus: 422,
      details: { fieldErrors },
    }),

  conflict: (userMessage: string, details?: Record<string, unknown>): AppError =>
    new AppError({
      code: 'CONFLICT',
      userMessage,
      httpStatus: 409,
      ...(details ? { details } : {}),
    }),

  /**
   * قاعدة عمل لم تُعتمد بعد من العميل.
   * ليست خطأً برمجيًا — بل رفض صريح لتنفيذ منطق مُخترَع.
   */
  businessRulePending: (ruleId: string, description: string): AppError =>
    new AppError({
      code: 'BUSINESS_RULE_PENDING',
      userMessage: 'هذه العملية بانتظار اعتماد قاعدة العمل الخاصة بها من الإدارة',
      httpStatus: 501,
      details: { ruleId, description },
    }),

  rateLimited: (retryAfterSeconds: number): AppError =>
    new AppError({
      code: 'RATE_LIMITED',
      userMessage: 'عدد المحاولات كبير، حاول مرة أخرى بعد قليل',
      httpStatus: 429,
      details: { retryAfterSeconds },
    }),

  internal: (cause?: unknown): AppError =>
    new AppError({
      code: 'INTERNAL_ERROR',
      userMessage: 'حدث خطأ غير متوقع، تم تسجيل المشكلة',
      httpStatus: 500,
      cause,
    }),
} as const;

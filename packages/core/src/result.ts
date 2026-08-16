import type { ActionResult, PaginationMeta } from '@erp/types';
import { AppError, errors } from './errors';

/** نتيجة ناجحة. */
export function ok<T>(data: T, meta?: PaginationMeta): ActionResult<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

/** نتيجة فاشلة من AppError. */
export function fail<T = never>(error: AppError): ActionResult<T> {
  return { success: false, error: error.toShape() };
}

/**
 * يحوّل أي استثناء إلى ActionResult آمن للعرض.
 *
 * ⚠️ الاستثناءات غير المعروفة تُعاد كـ INTERNAL_ERROR بلا أي تفاصيل داخلية،
 *    ويبقى الاستثناء الأصلي متاحًا للتسجيل عبر onUnexpected.
 */
export function toActionResult<T>(
  error: unknown,
  onUnexpected?: (error: unknown) => void,
): ActionResult<T> {
  if (AppError.isAppError(error)) {
    return fail<T>(error);
  }
  onUnexpected?.(error);
  return fail<T>(errors.internal(error));
}

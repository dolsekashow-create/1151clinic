import 'server-only';

import type { z } from 'zod';
import { AppError, errors, requirePermission, toActionResult, ok } from '@erp/core';
import type { ActionResult, AuditRecordInput, AuthContext, PaginationMeta } from '@erp/types';
import { requireAuth } from '@/modules/auth/session';
import { recordAudit } from '@/modules/audit/audit-service';

/**
 * غلاف موحّد لكل Server Action.
 *
 * يفرض الترتيب الإلزامي الموصوف في docs/API.md §2:
 *   1) مصادقة          → 401
 *   2) فحص صلاحية      → 403
 *   3) تحقق من المدخلات → 422
 *   4) تنفيذ المنطق
 *   5) سجل تدقيق (للعمليات المؤثرة)
 *
 * ⚠️ هذا الغلاف **لا يُغني** عن RLS. غرضه إرجاع خطأ مفهوم وقابل للتدقيق
 *    قبل أن ترفض قاعدة البيانات العملية بصمت (0 صفوف).
 */
export interface ActionConfig<TInput, TOutput> {
  /** الصلاحية المطلوبة. null = يكفي وجود جلسة (مثل قراءة الملف الشخصي). */
  permission: string | null;
  // المدخل `unknown` عمدًا: المخططات التي تستخدم .default()/.coerce يختلف
  // نوع مدخلها عن مخرجها، وتقييد المدخل يمنع تمريرها.
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  handler: (ctx: AuthContext, input: TInput) => Promise<TOutput>;
  /** يبني سجل التدقيق من المدخلات والمخرجات. غيابه = لا تدقيق (عمليات القراءة). */
  audit?: (ctx: AuthContext, input: TInput, output: TOutput) => AuditRecordInput;
}

export function defineAction<TInput, TOutput>(config: ActionConfig<TInput, TOutput>) {
  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    try {
      const ctx = await requireAuth();

      if (config.permission) {
        requirePermission(ctx, config.permission);
      }

      const parsed = config.schema.safeParse(rawInput);
      if (!parsed.success) {
        throw errors.validation(fieldErrors(parsed.error));
      }

      const output = await config.handler(ctx, parsed.data);

      if (config.audit) {
        await recordAudit(ctx, config.audit(ctx, parsed.data, output));
      }

      return ok(output);
    } catch (error) {
      return toActionResult<TOutput>(error, logUnexpected);
    }
  };
}

/** نسخة للقراءة: بلا تدقيق، مع دعم بيانات الترقيم. */
export function defineQuery<TInput, TOutput>(config: {
  permission: string | null;
  // المدخل `unknown` عمدًا: المخططات التي تستخدم .default()/.coerce يختلف
  // نوع مدخلها عن مخرجها، وتقييد المدخل يمنع تمريرها.
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  handler: (ctx: AuthContext, input: TInput) => Promise<{ data: TOutput; meta?: PaginationMeta }>;
}) {
  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    try {
      const ctx = await requireAuth();
      if (config.permission) requirePermission(ctx, config.permission);

      const parsed = config.schema.safeParse(rawInput);
      if (!parsed.success) throw errors.validation(fieldErrors(parsed.error));

      const { data, meta } = await config.handler(ctx, parsed.data);
      return ok(data, meta);
    } catch (error) {
      return toActionResult<TOutput>(error, logUnexpected);
    }
  };
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/**
 * ⚠️ الاستثناءات غير المتوقعة تُسجَّل في الخادم فقط.
 *    ما يصل للمستخدم هو INTERNAL_ERROR برسالة عامة — بلا أسماء جداول
 *    ولا استعلامات ولا آثار مكدس.
 */
function logUnexpected(error: unknown): void {
  if (AppError.isAppError(error)) return;
  console.error('[action] استثناء غير متوقع', error);
}

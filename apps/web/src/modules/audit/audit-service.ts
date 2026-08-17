import 'server-only';

import type { AuditRecordInput, AuthContext } from '@erp/types';
import { createClient } from '@/infrastructure/supabase/server';

/**
 * حقول لا تُكتب في سجل التدقيق أبدًا.
 * القائمة تُطبَّق على المفاتيح بعد التحويل لحروف صغيرة، وعلى أي مفتاح يحتوي
 * إحدى هذه الكلمات — لأن أسماء الحقول تتنوّع (password, passwordHash, api_key…).
 */
const REDACTED_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'credential',
  'private_key',
  'session',
  'otp',
  'pin',
];

const REDACTED_PLACEHOLDER = '[محجوب]';

/**
 * ينقّي القيم قبل الكتابة في سجل التدقيق.
 *
 * ⚠️ متطلب أمني صريح: ممنوع تسجيل كلمات المرور أو الأسرار أو المفاتيح.
 *    التنقية تتم هنا — في نقطة واحدة — لا في كل مُستدعٍ.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (REDACTED_KEY_PATTERNS.some((pattern) => lowered.includes(pattern))) {
      result[key] = REDACTED_PLACEHOLDER;
      continue;
    }
    result[key] = redact(item, depth + 1);
  }
  return result;
}

/**
 * يكتب سجل تدقيق.
 *
 * قرار متعمّد: فشل الكتابة **لا يُسقط** العملية الأصلية. عملية تجارية ناجحة
 * لا يجب أن تُلغى لأن سطر تدقيق فشل — لكن الفشل يُسجَّل في سجلات الخادم
 * ليُكتشف. (إن تحوّل التدقيق لاحقًا إلى متطلب امتثال صارم، يُنقل إلى نفس
 * معاملة العملية عبر دالة قاعدة بيانات.)
 */
export async function recordAudit(ctx: AuthContext, input: AuditRecordInput): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from('audit_logs').insert({
      organization_id: ctx.organizationId,
      branch_id: input.branchId,
      user_id: ctx.userId,
      action: input.action,
      module: input.module,
      entity_type: input.entityType,
      entity_id: input.entityId,
      old_values: (redact(input.oldValues ?? null) ?? null) as never,
      new_values: (redact(input.newValues ?? null) ?? null) as never,
    });
  } catch (error) {
    console.error('[audit] تعذّر كتابة سجل التدقيق', {
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

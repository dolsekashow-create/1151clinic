import type { ISODateTime, ModuleKey, UUID } from '@erp/types';

/**
 * تجريد الإشعارات.
 *
 * الهدف المعماري: منطق العمل يقول «أرسل إشعارًا»، ولا يعرف شيئًا عن المزوّد.
 * تغيير مزوّد الـ SMS لاحقًا = صنف جديد يُنفّذ NotificationProvider، بلا أي تعديل
 * في وحدات الحجوزات أو المالية أو غيرها.
 *
 * ⚠️ المزوّد الفعلي غير محدد بعد (Q-19) — لذلك لا يوجد أي تنفيذ حقيقي هنا.
 */

export type NotificationChannel = 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';

export type NotificationStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface NotificationTemplate {
  readonly key: string;
  readonly channel: NotificationChannel;
  readonly locale: string;
  readonly subject?: string | null;
  readonly body: string;
  /** أسماء المتغيرات المسموح بها داخل النص. */
  readonly variables: readonly string[];
}

export interface NotificationMessage {
  readonly id?: UUID;
  readonly organizationId: UUID;
  readonly branchId: UUID | null;
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly subject?: string | null;
  readonly body: string;
  /** لربط الإشعار بالعملية التي سبّبته. */
  readonly sourceModule?: ModuleKey;
  readonly sourceRecordId?: UUID | null;
  readonly scheduledAt?: ISODateTime | null;
}

export interface ProviderSendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string;
  readonly responseCode?: string;
  readonly responseMessage?: string;
  /** هل يستحق إعادة المحاولة؟ خطأ في الرقم لا يستحق، وانقطاع الشبكة يستحق. */
  readonly retryable: boolean;
}

/**
 * واجهة المزوّد. كل مزوّد (SMS/Email/Push/WhatsApp) يُنفّذها.
 *
 * ⚠️ المزوّد لا يقرأ متغيرات البيئة بنفسه — تُحقن إعداداته عند الإنشاء،
 *    حتى يبقى قابلًا للاختبار وحتى لا تتسرّب الأسرار إلى طبقة المجال.
 */
export interface NotificationProvider {
  readonly name: string;
  readonly channels: readonly NotificationChannel[];
  send(message: NotificationMessage): Promise<ProviderSendResult>;
}

/** سياسة إعادة المحاولة — تراجع تصاعدي أُسّي مع حد أقصى. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000,
};

export function nextRetryDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

export function shouldRetry(
  attempt: number,
  result: ProviderSendResult,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  return !result.ok && result.retryable && attempt < policy.maxAttempts;
}

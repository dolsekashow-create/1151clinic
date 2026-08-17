import { errors } from '../errors';
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationProvider,
  NotificationTemplate,
  ProviderSendResult,
} from './types';
import { DEFAULT_RETRY_POLICY, shouldRetry, type RetryPolicy } from './types';

/**
 * عرض قالب رسالة.
 *
 * صيغة المتغيّر: {{name}}
 * قرار متعمّد: متغيّر غير معرّف = خطأ صريح، لا سلسلة فارغة.
 * إرسال رسالة فيها «مرحبًا {{name}}» أو «مرحبًا » للعميل أسوأ من فشل الإرسال.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Readonly<Record<string, string | number>>,
): { subject: string | null; body: string } {
  const missing: string[] = [];

  const render = (text: string): string =>
    text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const value = variables[key];
      if (value === undefined || value === null) {
        missing.push(key);
        return '';
      }
      return String(value);
    });

  const body = render(template.body);
  const subject = template.subject ? render(template.subject) : null;

  if (missing.length > 0) {
    throw errors.validation({
      variables: [`متغيرات ناقصة في القالب ${template.key}: ${[...new Set(missing)].join(', ')}`],
    });
  }

  return { subject, body };
}

/** سجل مزوّدين — يختار المزوّد المناسب لكل قناة. */
export class ProviderRegistry {
  private readonly byChannel = new Map<NotificationChannel, NotificationProvider>();

  register(provider: NotificationProvider): this {
    for (const channel of provider.channels) {
      this.byChannel.set(channel, provider);
    }
    return this;
  }

  resolve(channel: NotificationChannel): NotificationProvider {
    const provider = this.byChannel.get(channel);
    if (!provider) {
      throw errors.conflict(`لا يوجد مزوّد مُهيّأ للقناة: ${channel}`, { channel });
    }
    return provider;
  }

  has(channel: NotificationChannel): boolean {
    return this.byChannel.has(channel);
  }
}

export interface DeliveryAttempt {
  readonly attemptNo: number;
  readonly provider: string;
  readonly result: ProviderSendResult;
}

export interface DeliveryOutcome {
  readonly delivered: boolean;
  readonly attempts: readonly DeliveryAttempt[];
  /** null = لا إعادة محاولة (نجح أو فشل نهائيًا). */
  readonly retryAfterMs: number | null;
}

/**
 * خدمة الإشعارات — تنسّق العرض والإرسال وإعادة المحاولة.
 *
 * ⚠️ لا تعرف أي مزوّد بعينه، ولا تقرأ البيئة، ولا تكتب في قاعدة البيانات.
 *    الاستمرارية (حفظ الحالة والسجلات) مسؤولية طبقة التطبيق.
 *
 * ⚠️ **متى** تُرسل الرسائل وما نصّها = P-17 معلّقة. هذه الخدمة تُرسل عند الطلب فقط،
 *    ولا يوجد أي مُشغّل تلقائي مرتبط بأحداث الحجوزات أو المالية.
 */
export class NotificationService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  /** محاولة إرسال واحدة. الجدولة وإعادة المحاولة يديرها المستدعي. */
  async attempt(message: NotificationMessage, attemptNo: number): Promise<DeliveryOutcome> {
    const provider = this.providers.resolve(message.channel);
    const result = await provider.send(message);
    const attempt: DeliveryAttempt = { attemptNo, provider: provider.name, result };

    if (result.ok) {
      return { delivered: true, attempts: [attempt], retryAfterMs: null };
    }

    const retry = shouldRetry(attemptNo, result, this.retryPolicy);
    return {
      delivered: false,
      attempts: [attempt],
      retryAfterMs: retry ? nextDelay(attemptNo, this.retryPolicy) : null,
    };
  }
}

function nextDelay(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);
}

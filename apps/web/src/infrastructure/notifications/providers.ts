import 'server-only';

import type { NotificationMessage, NotificationProvider, ProviderSendResult } from '@erp/core';
import { ProviderRegistry } from '@erp/core';
import { serverEnv } from '@/config/env';

/**
 * مزوّدو الإشعارات المُهيّأون في هذه البيئة.
 *
 * ⚠️ لا يوجد مزوّد SMS حقيقي. المزوّد والتسعير و API لم تُعتمد بعد (Q-19).
 *    المزوّد الوحيد المتاح هو `console` للتطوير: يسجّل الرسالة ولا يرسلها.
 *
 * إضافة مزوّد حقيقي لاحقًا:
 *   1. أنشئ صنفًا يُنفّذ NotificationProvider في هذا المجلد.
 *   2. سجّله في buildProviderRegistry() حسب قيمة متغيّر البيئة.
 *   3. لا تغيير في أي وحدة أعمال — هذا هو الغرض من التجريد.
 */

class ConsoleProvider implements NotificationProvider {
  readonly name = 'console';
  readonly channels = ['sms', 'email', 'push', 'whatsapp', 'in_app'] as const;

  async send(message: NotificationMessage): Promise<ProviderSendResult> {
    // ⚠️ نسجّل القناة والمستلم وطول النص فقط — لا نص الرسالة كاملًا،
    //    لأن الرسائل قد تحتوي بيانات عميل.
    console.info('[notifications] رسالة (وضع التطوير — لم تُرسل فعليًا)', {
      channel: message.channel,
      recipient: maskRecipient(message.recipient),
      bodyLength: message.body.length,
      sourceModule: message.sourceModule,
    });

    return {
      ok: true,
      providerMessageId: `console-${Date.now()}`,
      responseCode: '200',
      responseMessage: 'logged',
      retryable: false,
    };
  }
}

/** مزوّد صامت: يفشل صراحةً بدل الإيهام بالإرسال. */
class NoopProvider implements NotificationProvider {
  readonly name = 'noop';
  readonly channels = ['sms', 'email', 'push', 'whatsapp', 'in_app'] as const;

  async send(): Promise<ProviderSendResult> {
    return {
      ok: false,
      responseCode: 'NO_PROVIDER',
      responseMessage: 'لم يُعتمد مزوّد إرسال بعد',
      retryable: false,
    };
  }
}

function maskRecipient(recipient: string): string {
  if (recipient.length <= 4) return '****';
  return `${recipient.slice(0, 3)}****${recipient.slice(-2)}`;
}

export function buildProviderRegistry(): ProviderRegistry {
  const { NOTIFICATIONS_SMS_PROVIDER } = serverEnv();
  const registry = new ProviderRegistry();

  switch (NOTIFICATIONS_SMS_PROVIDER) {
    case 'console':
      registry.register(new ConsoleProvider());
      break;
    default:
      // مزوّد غير معروف = لا إرسال صامت. الفشل الصريح أفضل من رسالة ضائعة.
      registry.register(new NoopProvider());
  }

  return registry;
}

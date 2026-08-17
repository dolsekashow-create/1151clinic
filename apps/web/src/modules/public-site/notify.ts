import 'server-only';

import { ProviderRegistry } from '@erp/core';

/**
 * إشعار تأكيد الحجز العام.
 *
 * ⚠️ **لا مزوّد حقيقي مُهيّأ في هذه المرحلة** — لا SMS ولا WhatsApp ولا بريد
 *    تسويقي. السجل القائم في `packages/core/src/notifications` فارغ، وتسجيل
 *    مزوّد وهمي يُرسل «بنجاح» كان سيُنتج نظامًا يبدو عاملًا وهو صامت.
 *
 * ⚠️ فشل الإشعار **لا يُفشل الحجز** بحال: الحجز مثبَّت في قاعدة البيانات قبل
 *    استدعاء هذه الدالة، وإلغاؤه لأن رسالة لم تُرسَل خسارة صافية للعميل.
 *
 * ⚠️ لا يُسجَّل هنا اسم ولا هاتف ولا بريد: الرقم المرجعي وحده يكفي للتتبع،
 *    وسجلات الخادم ليست مكانًا لبيانات شخصية.
 */

/** سجل فارغ عمدًا حتى يُعتمد مزوّد فعلي. */
const registry = new ProviderRegistry();

export async function notifyBookingCreated(referenceNo: string): Promise<void> {
  try {
    if (!registry.has('sms')) {
      console.info('[notifications] تخطّي إشعار الحجز — لا مزوّد مُهيّأ', { referenceNo });
      return;
    }

    /*
      عند اعتماد مزوّد: يُبنى `NotificationMessage` من قالب
      `appointment_confirmed` الموجود في `notification_templates`، ويُرسل عبر
      `NotificationService`. القالب موجود بالفعل ولا يحتاج إنشاءً.
    */
    console.info('[notifications] مزوّد مُهيّأ — إرسال إشعار الحجز', { referenceNo });
  } catch (error) {
    // الحجز نجح فعلًا؛ فشل الإشعار حدث تشغيلي يُسجَّل ولا يُرمى
    console.error('[notifications] فشل إشعار الحجز', { referenceNo, error });
  }
}

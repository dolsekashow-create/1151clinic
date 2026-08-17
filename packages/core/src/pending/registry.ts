import { errors } from '../errors';

/**
 * سجل قواعد العمل المعلّقة (BUSINESS_RULE_PENDING).
 *
 * الغرض: بدل اختراع منطق ثم اكتشاف أنه خاطئ لاحقًا، نُصرّح بالقاعدة المعلّقة
 * في مكان واحد، ونرفض تنفيذها صراحةً حتى تُعتمد.
 *
 * دورة الحياة:
 *   1. القاعدة هنا بحالة `pending` ⇒ استدعاؤها يرمي خطأ 501 واضحًا.
 *   2. عند اعتمادها من العميل: يُنفَّذ المنطق، ويُحذف السطر من هنا،
 *      ويُنقل البند في docs/REQUIREMENTS.md من §2 إلى §1.
 *
 * كل معرّف هنا يطابق معرّف البند في docs/REQUIREMENTS.md §2.
 */
export interface PendingRule {
  readonly id: string;
  readonly module: string;
  readonly description: string;
  /** ما الذي نحتاج معرفته لاعتمادها. */
  readonly blockingQuestion: string;
}

export const PENDING_RULES: readonly PendingRule[] = [
  {
    id: 'P-01',
    module: 'finance',
    description: 'معادلة تقفيل الوردية واحتساب الفروقات',
    blockingQuestion: 'كيف تُقفَّل الوردية اليوم يدويًا، وما مكونات الرصيد المتوقع؟',
  },
  {
    id: 'P-02',
    module: 'finance',
    description: 'طريقة القيد المحاسبي ودليل الحسابات',
    blockingQuestion: 'هل يوجد دليل حسابات معتمد؟ وما القيد المقابل لكل نوع حركة؟',
  },
  {
    id: 'P-03',
    module: 'finance',
    description: 'الأحداث التشغيلية التي تُولّد حركة مالية تلقائيًا وتوقيتها',
    blockingQuestion: 'متى تُسجَّل الحركة المالية: عند الاستلام أم عند الاعتماد أم عند الدفع؟',
  },
  {
    id: 'P-04',
    module: 'finance',
    description: 'سياسة تسليم العهدة والموافقات عليها',
    blockingQuestion: 'من يسلّم لمن؟ وهل يلزم اعتماد طرف ثالث؟',
  },
  {
    id: 'P-05',
    module: 'inventory',
    description: 'دورة المخزن الكاملة وحالات كل خطوة',
    blockingQuestion: 'ما خطوات الاستلام والصرف والتحويل والجرد الحالية بالضبط؟',
  },
  {
    id: 'P-06',
    module: 'inventory',
    description: 'طريقة تقييم تكلفة المخزون',
    blockingQuestion: 'متوسط مرجّح أم FIFO؟',
  },
  {
    id: 'P-07',
    module: 'inventory',
    description: 'السماح بالرصيد السالب من عدمه',
    blockingQuestion: 'هل يُسمح بالصرف عند نفاد الرصيد؟',
  },
  {
    id: 'P-08',
    module: 'purchasing',
    description: 'سلسلة الموافقات وحدود المبالغ',
    blockingQuestion: 'كم خطوة اعتماد؟ ومن المعتمِد في كل خطوة؟ وهل تختلف بحسب المبلغ؟',
  },
  {
    id: 'P-09',
    module: 'purchasing',
    description: 'إلزامية طلب الشراء قبل أمر الشراء',
    blockingQuestion: 'هل يمكن إصدار أمر شراء مباشرة بلا طلب؟',
  },
  {
    id: 'P-10',
    module: 'purchasing',
    description: 'الاستلام الجزئي وأثره على الالتزام للمورد',
    blockingQuestion: 'هل يُقبل الاستلام الجزئي؟ وكيف يُعالج الباقي؟',
  },
  /*
    اعتُمد في 2026-08-17:
      • قائمة الحالات الخمس (كانت جزءًا من P-11) ⇒ مُنفَّذة في ترحيل 150000.
      • منع التعارض (P-12 كاملة) ⇒ مُنفَّذ بقيد استبعاد في ترحيل 140000.
    ما تبقّى من P-11 هو الانتقالات وحدها، ولذلك بقي البند بنصّ أضيق.
  */
  {
    id: 'P-11',
    module: 'appointments',
    description: 'قواعد الانتقال بين حالات الحجز (القائمة نفسها اعتُمدت)',
    blockingQuestion:
      'ما الانتقالات المسموحة بين الحالات الخمس؟ مثلًا هل يُعاد «مكتمل» إلى «مجدول»؟',
  },
  {
    id: 'P-13',
    module: 'appointments',
    description: 'سياسة الإلغاء وإعادة الجدولة',
    blockingQuestion: 'هل توجد مهلة إلغاء أو رسوم؟',
  },
  {
    id: 'P-14',
    module: 'services',
    description: 'التسعير والخصومات والباقات والعمولات',
    blockingQuestion: 'هل السعر موحّد بين الفروع؟ وما قواعد الخصم والعمولة؟',
  },
  {
    id: 'P-17',
    module: 'notifications',
    description: 'متى تُرسل الرسائل وقوالبها ومن يعتمدها',
    blockingQuestion: 'ما الأحداث التي تستوجب إشعار العميل؟ وما نص كل رسالة؟',
  },
] as const;

const RULES_BY_ID = new Map(PENDING_RULES.map((r) => [r.id, r]));

export function getPendingRule(id: string): PendingRule | undefined {
  return RULES_BY_ID.get(id);
}

export function pendingRulesByModule(module: string): readonly PendingRule[] {
  return PENDING_RULES.filter((r) => r.module === module);
}

/**
 * يرفض تنفيذ قاعدة عمل غير معتمدة.
 *
 * استخدمها في مكان المنطق المفقود — لا تكتب تنفيذًا تخمينيًا:
 *
 * ```ts
 * export function closeShift() {
 *   // BUSINESS_RULE_PENDING: معادلة التقفيل غير معتمدة
 *   throw businessRulePending('P-01');
 * }
 * ```
 */
export function businessRulePending(id: string): never {
  const rule = RULES_BY_ID.get(id);
  throw errors.businessRulePending(id, rule?.description ?? 'قاعدة عمل غير معرّفة في السجل');
}

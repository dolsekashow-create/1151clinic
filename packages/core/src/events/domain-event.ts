import type { ISODateTime, ModuleKey, UUID } from '@erp/types';

/**
 * حدث مجال (Domain Event).
 *
 * الغرض المعماري: فصل الوحدات عن بعضها.
 * مثال: «استلام مخزون» يُصدر حدثًا؛ الوحدة المالية *قد* تستمع إليه لاحقًا
 * لتوليد حركة مالية — بدون أن تعرف وحدة المخزون شيئًا عن المالية.
 *
 * ⚠️ الاشتراكات المالية غير مُفعّلة (P-03 غير معتمدة). البنية جاهزة فقط.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly name: string;
  readonly occurredAt: ISODateTime;
  readonly organizationId: UUID;
  readonly branchId: UUID | null;
  readonly actorId: UUID | null;
  /** الوحدة والسجل المصدر — يُستخدمان لربط الحركة المالية بمسببها. */
  readonly sourceModule: ModuleKey;
  readonly sourceRecordId: UUID | null;
  readonly payload: TPayload;
}

export type DomainEventHandler<T = Record<string, unknown>> = (
  event: DomainEvent<T>,
) => Promise<void> | void;

/**
 * ناقل أحداث في الذاكرة.
 *
 * كافٍ للمرحلة الحالية (عملية واحدة). عند الحاجة لضمانات تسليم أقوى
 * (طابور دائم / إعادة محاولة) يُستبدل التنفيذ خلف نفس الواجهة.
 */
export class InMemoryEventBus {
  private readonly handlers = new Map<string, DomainEventHandler<never>[]>();

  subscribe<T>(eventName: string, handler: DomainEventHandler<T>): () => void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as DomainEventHandler<never>);
    this.handlers.set(eventName, list);
    return () => {
      const current = this.handlers.get(eventName);
      if (!current) return;
      this.handlers.set(
        eventName,
        current.filter((h) => h !== (handler as DomainEventHandler<never>)),
      );
    };
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    const list = this.handlers.get(event.name);
    if (!list?.length) return;
    for (const handler of list) {
      await (handler as DomainEventHandler<T>)(event);
    }
  }

  subscriberCount(eventName: string): number {
    return this.handlers.get(eventName)?.length ?? 0;
  }
}

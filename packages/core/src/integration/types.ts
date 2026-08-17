import type { ISODateTime, UUID } from '@erp/types';

/**
 * طبقة التكامل مع النظام القديم — **واجهات فقط**.
 *
 * ⚠️ لا يوجد أي تنفيذ، ولن يُكتب قبل تحليل النظام القديم (Q-17):
 *    ما هو المنتج؟ هل يوفّر API؟ هل يمكن الوصول لقاعدة بياناته؟
 *    كتابة محوّل الآن يعني تخمين شكل البيانات — وهو إهدار مؤكد.
 *
 * ما تضمنه هذه الواجهات:
 *   • أن الاستيراد **قابل للتكرار بلا ازدواج** (idempotent) عبر جدول الربط.
 *   • أن أي نظام مصدر يُضاف لاحقًا يستهلك نفس العقد.
 */

export type IntegrationDirection = 'inbound' | 'outbound';

export interface LegacyRecordRef {
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly legacyId: string;
}

export interface EntityMapping extends LegacyRecordRef {
  readonly newId: UUID;
  readonly createdAt: ISODateTime;
}

/** يمنع إنشاء سجل مرتين عند إعادة تشغيل الاستيراد. */
export interface MappingStore {
  find(ref: LegacyRecordRef): Promise<EntityMapping | null>;
  save(mapping: Omit<EntityMapping, 'createdAt'>): Promise<void>;
}

export interface ImportResult {
  readonly total: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly errors: ReadonlyArray<{ legacyId: string; message: string }>;
}

/**
 * محوّل استيراد لكيان واحد من نظام مصدر واحد.
 * التنفيذ الفعلي مؤجل — انظر أعلاه.
 */
export interface ImportAdapter<TLegacyRecord> {
  readonly sourceSystem: string;
  readonly entityType: string;
  /** يقرأ دفعة من النظام المصدر. */
  fetchBatch(cursor: string | null, limit: number): Promise<{
    records: readonly TLegacyRecord[];
    nextCursor: string | null;
  }>;
  /** يستخرج معرّف السجل في النظام القديم. */
  legacyIdOf(record: TLegacyRecord): string;
  /** يحوّل السجل إلى شكل النظام الجديد. */
  transform(record: TLegacyRecord, organizationId: UUID): Promise<Record<string, unknown>>;
}

export interface SyncSchedule {
  readonly enabled: boolean;
  readonly direction: IntegrationDirection;
  readonly entityType: string;
  /** تعبير cron. لا يوجد مُشغّل مُهيّأ بعد. */
  readonly cron: string;
}

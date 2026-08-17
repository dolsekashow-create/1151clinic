import type { ISODateTime, ModuleKey, UUID } from '@erp/types';

/**
 * بنية التقارير.
 *
 * ⚠️ لا يوجد أي تقرير مُعرَّف هنا. قائمة التقارير المطلوبة = P-18 معلّقة
 *    (تُحدَّد من مسؤولي الأقسام). ما هو مبني: آلية تعريف تقرير وتنفيذه وتصديره،
 *    بحيث تصبح إضافة تقرير جديد = ملف تعريف واحد بلا تغيير في البنية.
 */

export type ReportFilterType = 'date_range' | 'branch' | 'select' | 'text' | 'boolean';

export interface ReportFilterDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: ReportFilterType;
  readonly required?: boolean;
  readonly options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface ReportColumnDefinition {
  readonly key: string;
  readonly label: string;
  readonly align?: 'start' | 'center' | 'end';
  /** أعمدة رقمية تُعرض بخط جدولي وتقبل الجمع في التذييل. */
  readonly numeric?: boolean;
}

export interface ReportDefinition {
  readonly key: string;
  readonly nameAr: string;
  readonly module: ModuleKey;
  /** الصلاحية المطلوبة لتشغيل التقرير — إضافة إلى reports.view. */
  readonly permission: string;
  readonly filters: readonly ReportFilterDefinition[];
  readonly columns: readonly ReportColumnDefinition[];
  /** هل يحتاج نطاق فرع إلزامي؟ التقارير المالية عادةً نعم. */
  readonly requiresBranchScope: boolean;
}

export interface ReportQuery {
  readonly reportKey: string;
  readonly organizationId: UUID;
  readonly branchIds: readonly UUID[] | null;
  readonly from?: ISODateTime;
  readonly to?: ISODateTime;
  readonly filters: Readonly<Record<string, string | number | boolean | null>>;
  readonly page: number;
  readonly pageSize: number;
}

export interface ReportResult {
  readonly definition: ReportDefinition;
  readonly rows: ReadonlyArray<Record<string, string | number | null>>;
  readonly total: number;
  readonly generatedAt: ISODateTime;
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * مُصدِّر التقارير.
 * CSV فقط هو المتاح في هذه المرحلة؛ XLSX و PDF يُضافان كتنفيذات إضافية
 * بلا تغيير في المستدعي.
 */
export interface ReportExporter {
  readonly format: ExportFormat;
  readonly mimeType: string;
  export(result: ReportResult): Promise<Uint8Array>;
}

/** سجل التقارير — يبدأ فارغًا عمدًا حتى تُعتمد قائمة التقارير. */
export class ReportRegistry {
  private readonly definitions = new Map<string, ReportDefinition>();

  register(definition: ReportDefinition): this {
    this.definitions.set(definition.key, definition);
    return this;
  }

  get(key: string): ReportDefinition | undefined {
    return this.definitions.get(key);
  }

  list(): readonly ReportDefinition[] {
    return [...this.definitions.values()];
  }

  /** التقارير التي يستطيع المستخدم تشغيلها بصلاحياته. */
  listAllowed(permissions: readonly string[]): readonly ReportDefinition[] {
    if (!permissions.includes('reports.view')) return [];
    return this.list().filter((definition) => permissions.includes(definition.permission));
  }
}

/**
 * تحويل نتيجة تقرير إلى CSV.
 *
 * ⚠️ الحقول التي تبدأ بـ = + - @ تُسبَق بعلامة اقتباس: بدون ذلك يفسّرها
 *    Excel كصيغة قابلة للتنفيذ (CSV injection) عند فتح ملف مُصدَّر.
 */
export function toCsv(result: ReportResult): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/["\n,;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const header = result.definition.columns.map((column) => escape(column.label)).join(',');
  const rows = result.rows.map((row) =>
    result.definition.columns.map((column) => escape(row[column.key] ?? null)).join(','),
  );

  // BOM لضمان قراءة النص العربي بشكل صحيح في Excel
  return `﻿${[header, ...rows].join('\r\n')}`;
}

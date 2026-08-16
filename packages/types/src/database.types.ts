/**
 * Supabase generated database types.
 *
 * ⚠️  هذا الملف مُولّد آليًا — لا تُعدّله يدويًا.
 *     يُعاد توليده عبر:  pnpm db:types
 *
 * الحالة (Phase 1): لا توجد جداول بعد — المخطط فارغ عمدًا.
 * أول توليد حقيقي يتم في Phase 2 بعد إنشاء جداول الهوية والصلاحيات.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

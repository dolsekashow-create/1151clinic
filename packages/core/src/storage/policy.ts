import type { AuthContext, UUID } from '@erp/types';
import { canAccessBranch, hasPermission } from '../authorization/policy';
import { errors } from '../errors';

/**
 * سياسة الوصول للملفات.
 *
 * ⚠️ الملفات في Supabase Storage تُحفظ في buckets **خاصة**. الوصول لا يتم
 *    برابط عام، بل برابط موقّع قصير الأجل يُصدره الخادم بعد فحص الصلاحية هنا.
 *    جعل bucket عامًا يعني أن أي شخص يعرف المسار يقرأ الملف — بلا RLS وبلا تدقيق.
 */

export interface FileDescriptor {
  readonly id: UUID;
  readonly organizationId: UUID;
  readonly branchId: UUID | null;
  readonly bucket: string;
  readonly storagePath: string;
  readonly requiredPermission: string | null;
  readonly isPublic: boolean;
}

/** المدة الافتراضية للرابط الموقّع: قصيرة عمدًا للحد من إعادة المشاركة. */
export const SIGNED_URL_TTL_SECONDS = 300;

export function canAccessFile(ctx: AuthContext, file: FileDescriptor): boolean {
  if (ctx.organizationId !== file.organizationId) return false;
  if (!canAccessBranch(ctx, file.branchId) && file.branchId !== null) return false;
  if (file.requiredPermission && !hasPermission(ctx, file.requiredPermission)) return false;
  return true;
}

export function requireFileAccess(ctx: AuthContext, file: FileDescriptor): void {
  if (!canAccessFile(ctx, file)) {
    // نُرجع NOT_FOUND لا PERMISSION_DENIED: تمييز الاثنين يكشف وجود ملفات
    // في فروع أخرى (information disclosure).
    throw errors.notFound('file');
  }
}

/** أنواع الملفات المسموح برفعها. القائمة مغلقة عمدًا. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function validateUpload(input: { mimeType: string; sizeBytes: number }): void {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw errors.validation({ file: ['نوع الملف غير مسموح به'] });
  }
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw errors.validation({ file: ['حجم الملف يتجاوز الحد المسموح (20 ميجابايت)'] });
  }
}

/**
 * يبني مسار تخزين معزولًا حسب المنشأة والفرع.
 * العزل في المسار يجعل سياسات Storage قابلة للكتابة بشكل بسيط ومراجَع.
 */
export function buildStoragePath(params: {
  organizationId: UUID;
  branchId: UUID | null;
  entityType: string;
  entityId: UUID;
  fileName: string;
}): string {
  const safeName = params.fileName.replace(/[^\w.\-؀-ۿ]/g, '_').slice(0, 120);
  const branchSegment = params.branchId ?? 'org';
  return `${params.organizationId}/${branchSegment}/${params.entityType}/${params.entityId}/${Date.now()}-${safeName}`;
}

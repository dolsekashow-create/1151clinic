import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { errors } from '@erp/core';
import type { UUID } from '@erp/types';
import { createPublicClient } from '@/infrastructure/supabase/public';

/**
 * الحجز العام — طبقة الوصول.
 *
 * ⚠️ **بدور `anon` حصرًا** عبر `createPublicClient()`. لا مفتاح خدمة ولا تجاوز
 *    لـRLS في أي مسار هنا. كل قرار تصريح داخل دوال `SECURITY DEFINER` في
 *    قاعدة البيانات، وهي تُعيد فحص النشر والترابط والتوفّر بنفسها.
 *
 * ⚠️ لا يوجد في هذا الملف أي حساب لأوقات متاحة: الأوقات تأتي من المحرّك كما
 *    هي. أي حساب موازٍ في TypeScript كان سيُنتج شاشة تعرض وقتًا يرفضه الحجز.
 */

export interface PublicSlot {
  /** لحظة مطلقة بصيغة ISO — تُنسَّق بتوقيت الفرع في الواجهة. */
  startsAt: string;
}

export interface PublicBookingResult {
  referenceNo: string;
  /** true = مفتاح عدم التكرار كان مستخدمًا وأُعيد الحجز السابق. */
  reused: boolean;
}

export interface PublicBookingConfirmation {
  referenceNo: string;
  scheduledAt: string;
  durationMinutes: number;
  branchName: string;
  branchCity: string | null;
  branchPhone: string | null;
  serviceName: string | null;
  providerName: string | null;
  statusKey: string;
}

export interface PublicBookingInput {
  branchId: string;
  serviceId: string;
  providerId: string;
  slot: string;
  fullName: string;
  phone: string;
  email?: string | undefined;
  notes?: string | undefined;
  /** مفتاح عشوائي من المتصفح — يُجزَّأ قبل مغادرة الخادم. */
  idempotencyKey?: string | undefined;
}

/** الأوقات المتاحة ليوم واحد. */
export async function listPublicSlots(input: {
  branchId: string;
  serviceId: string;
  providerId: string;
  date: string;
}): Promise<readonly PublicSlot[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('public_available_slots', {
    p_branch: input.branchId,
    p_service: input.serviceId,
    p_provider: input.providerId,
    p_date: input.date,
  });

  // ⚠️ لا نُمرّر رسالة المحرّك: قد تكشف أسماء جداول أو قيودًا
  if (error) throw errors.internal(error);
  return (data ?? []).map((row: { slot_start: string }) => ({ startsAt: row.slot_start }));
}

/**
 * إنشاء الحجز.
 *
 * ⚠️ المدة والنهاية والحالة والرقم المرجعي والمنشأة **غير ممرَّرة** — لا وجود
 *    لها في توقيع الدالة أصلًا، فلا سبيل لتزويرها من المتصفح.
 * ⚠️ مفتاح عدم التكرار يُجزَّأ هنا: تخزينه خامًا يجعل من يقرأ الجدول قادرًا
 *    على انتحال إعادة إرسال طلب أي زائر.
 */
export async function createPublicBooking(
  input: PublicBookingInput,
): Promise<PublicBookingResult> {
  const supabase = createPublicClient();

  const keyHash = input.idempotencyKey
    ? createHash('sha256').update(input.idempotencyKey).digest('base64url')
    : null;

  const { data, error } = await supabase.rpc('create_public_booking', {
    p_branch: input.branchId,
    p_service: input.serviceId,
    p_provider: input.providerId,
    p_slot: input.slot,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_email: input.email ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_hash: keyHash,
  });

  if (error) throw translateBookingError(error);

  const row = data?.[0];
  if (!row) throw errors.internal(new Error('لم تُرجع دالة الحجز نتيجة'));
  return { referenceNo: row.reference_no, reused: row.reused };
}

/** بيانات التأكيد — بلا أي بيانات شخصية (تفرضه الدالة في قاعدة البيانات). */
export async function getPublicBooking(
  reference: string,
): Promise<PublicBookingConfirmation | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('get_public_booking', { p_reference: reference });
  if (error) throw errors.internal(error);

  const row = data?.[0];
  if (!row) return null;
  return {
    referenceNo: row.reference_no,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    branchName: row.branch_name,
    branchCity: row.branch_city,
    branchPhone: row.branch_phone,
    serviceName: row.service_name,
    providerName: row.provider_name,
    statusKey: row.status_key,
  };
}

/** مفتاح عدم تكرار للنموذج — يُولَّد مرة واحدة لكل محاولة حجز. */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/* ------------------------------ خيارات النموذج ---------------------------- */

export interface PublicOption {
  id: UUID;
  nameAr: string;
  subtitle?: string | null;
}

/**
 * الخدمات المتاحة للحجز في فرع منشور.
 * ⚠️ يقرأ بدور anon ⇒ ما لم يُنشَر لا يظهر. لا سعر ولا بيانات داخلية.
 */
export async function listBookableServices(branchId: string): Promise<readonly PublicOption[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('public_bookable_services', { p_branch: branchId });
  if (error) throw errors.internal(error);

  return (data ?? []).map((s: { id: string; name_ar: string; duration_minutes: number }) => ({
    id: s.id as UUID,
    nameAr: s.name_ar,
    subtitle: s.duration_minutes ? `${s.duration_minutes} دقيقة` : null,
  }));
}

/**
 * مقدّمو الخدمة المتاحون لخدمة في فرع.
 * ⚠️ الهاتف والبريد محجوبان عن anon على مستوى **أعمدة** قاعدة البيانات، فلا
 *    يمكن لهذا الاستعلام كشفهما مهما تغيّر.
 */
export async function listBookableProviders(
  branchId: string,
  serviceId: string,
): Promise<readonly PublicOption[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('public_bookable_providers', {
    p_branch: branchId,
    p_service: serviceId,
  });
  if (error) throw errors.internal(error);

  return (data ?? []).map((p: { id: string; full_name_ar: string; specialty: string | null }) => ({
    id: p.id as UUID,
    nameAr: p.full_name_ar,
    subtitle: p.specialty,
  }));
}

/* --------------------------------- أخطاء --------------------------------- */

/**
 * يحوّل أخطاء المحرّك إلى رسائل عربية مفهومة.
 *
 * ⚠️ رسائل الدالة العامة مكتوبة أصلًا للمستخدم النهائي ولا تكشف بنية جداول،
 *    فتُمرَّر كما هي. أي خطأ آخر يُعمَّم بلا تفاصيل — ممنوع تسريب SQL أو أسماء
 *    قيود أو آثار مكدس إلى المتصفح.
 */
function translateBookingError(error: { code?: string; message?: string }): Error {
  if (error.code === '22023' || error.code === 'P0001') {
    return errors.conflict(error.message ?? 'تعذّر إنشاء الحجز، حاول مرة أخرى');
  }
  if (error.code === '23P01') {
    return errors.conflict('هذا الموعد لم يعد متاحًا، اختر وقتًا آخر');
  }
  if (error.code === '42501') {
    return errors.operationDenied('الحجز غير متاح حاليًا');
  }
  return errors.internal(error);
}

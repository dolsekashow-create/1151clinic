import 'server-only';

import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type {
  AttendanceCorrectionInput,
  AttendanceListQueryInput,
  BranchLocationInput,
  CheckInInput,
  CheckOutInput,
  MonthlySummaryInput,
} from './schemas';

/**
 * الوصول للبيانات — الحضور والانصراف.
 *
 * ⚠️ كل شيء بجلسة المستخدم ⇒ RLS مُطبَّق. **لا مفتاح خدمة هنا إطلاقًا**:
 *    الحضور عملية موظف عادية، وتجاوز RLS فيها يُلغي عزل الفروع.
 * ⚠️ لا يوجد مسار كتابة مباشر لجدول الحضور: الدخول والخروج عبر دالتين في
 *    قاعدة البيانات تحسبان الوقت والمسافة بنفسيهما.
 */

export interface AttendanceRow {
  id: UUID;
  userId: UUID;
  userName: string;
  branchId: UUID;
  branchName: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  durationMinutes: number | null;
  checkInDistance: number;
  checkOutDistance: number | null;
  notes: string | null;
}

export interface OpenSession {
  id: UUID;
  branchId: UUID;
  branchName: string;
  checkedInAt: string;
}

export interface MonthlySummaryRow {
  userId: UUID;
  fullNameAr: string;
  branchId: UUID;
  branchName: string;
  sessionsCount: number;
  totalMinutes: number;
  openSessions: number;
}

export interface BranchLocationRow {
  id: UUID;
  nameAr: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
}

const COLUMNS =
  'id, user_id, branch_id, checked_in_at, checked_out_at, duration_minutes, check_in_distance_meters, check_out_distance_meters, notes';

/* ============================ الدخول والخروج ============================= */

export async function checkIn(
  _ctx: AuthContext,
  input: CheckInInput,
): Promise<{ sessionId: UUID; distanceMeters: number; checkedInAt: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_check_in', {
    p_branch: input.branchId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
  });

  if (error) throw translate(error);
  const row = data?.[0];
  if (!row) throw errors.internal(new Error('لم تُرجع دالة الحضور نتيجة'));

  return {
    sessionId: row.session_id as UUID,
    distanceMeters: Number(row.distance_meters),
    checkedInAt: row.checked_in_at,
  };
}

export async function checkOut(
  _ctx: AuthContext,
  input: CheckOutInput,
): Promise<{ durationMinutes: number; distanceMeters: number | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_check_out', {
    p_latitude: input.latitude,
    p_longitude: input.longitude,
  });

  if (error) throw translate(error);
  const row = data?.[0];
  if (!row) throw errors.internal(new Error('لم تُرجع دالة الانصراف نتيجة'));

  return {
    durationMinutes: row.duration_minutes ?? 0,
    distanceMeters: row.distance_meters === null ? null : Number(row.distance_meters),
  };
}

/** الجلسة المفتوحة للمستخدم الحالي — تحدّد أي زر يُعرض له. */
export async function getOpenSession(ctx: AuthContext): Promise<OpenSession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_sessions')
    .select('id, branch_id, checked_in_at')
    .eq('user_id', ctx.userId)
    .is('checked_out_at', null)
    .maybeSingle();

  if (!data) return null;

  const { data: branch } = await supabase
    .from('branches')
    .select('name_ar')
    .eq('id', data.branch_id)
    .maybeSingle();

  return {
    id: data.id as UUID,
    branchId: data.branch_id as UUID,
    branchName: branch?.name_ar ?? '—',
    checkedInAt: data.checked_in_at,
  };
}

/* ================================ القراءة ================================ */

export async function listAttendance(
  _ctx: AuthContext,
  input: AttendanceListQueryInput,
): Promise<Paginated<AttendanceRow>> {
  const supabase = await createClient();

  let query = supabase.from('attendance_sessions').select(COLUMNS, { count: 'exact' });

  if (input.branchId) query = query.eq('branch_id', input.branchId);
  if (input.userId) query = query.eq('user_id', input.userId);
  if (input.status === 'open') query = query.is('checked_out_at', null);
  if (input.status === 'closed') query = query.not('checked_out_at', 'is', null);
  if (input.from) query = query.gte('checked_in_at', `${input.from}T00:00:00Z`);
  if (input.to) query = query.lte('checked_in_at', `${input.to}T23:59:59Z`);

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('checked_in_at', { ascending: false })
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const branchIds = [...new Set(rows.map((r) => r.branch_id))];

  // الأسماء بجلسة المستخدم نفسها ⇒ ما لا يراه يظهر «—» لا بيانات مسرّبة
  const [profiles, branches] = await Promise.all([
    userIds.length ? supabase.from('profiles').select('id, full_name_ar').in('id', userIds) : null,
    branchIds.length ? supabase.from('branches').select('id, name_ar').in('id', branchIds) : null,
  ]);

  const userMap = new Map((profiles?.data ?? []).map((p) => [p.id, p.full_name_ar]));
  const branchMap = new Map((branches?.data ?? []).map((b) => [b.id, b.name_ar]));

  const total = count ?? 0;
  return {
    items: rows.map((r) => ({
      id: r.id as UUID,
      userId: r.user_id as UUID,
      userName: userMap.get(r.user_id) ?? '—',
      branchId: r.branch_id as UUID,
      branchName: branchMap.get(r.branch_id) ?? '—',
      checkedInAt: r.checked_in_at,
      checkedOutAt: r.checked_out_at,
      durationMinutes: r.duration_minutes,
      checkInDistance: Number(r.check_in_distance_meters),
      checkOutDistance: r.check_out_distance_meters === null ? null : Number(r.check_out_distance_meters),
      notes: r.notes,
    })),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

/**
 * الملخّص الشهري — يُحسب في المحرّك.
 * ⚠️ الشهر يُحدَّد بتوقيت **الفرع** لا بتوقيت الخادم، وجمع الدقائق في
 *    TypeScript عبر آلاف الصفوف يُنتج فروقًا على حدود الشهر.
 */
export async function getMonthlySummary(
  _ctx: AuthContext,
  input: MonthlySummaryInput,
): Promise<readonly MonthlySummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_monthly_summary', {
    p_month: input.month,
    p_branch: input.branchId ?? null,
  });
  if (error) throw errors.internal(error);

  const rows = data ?? [];
  const branchIds = [...new Set(rows.map((r: { branch_id: string }) => r.branch_id))];
  const { data: branches } = branchIds.length
    ? await supabase.from('branches').select('id, name_ar').in('id', branchIds as string[])
    : { data: [] };
  const branchMap = new Map((branches ?? []).map((b) => [b.id, b.name_ar]));

  return rows.map(
    (r: {
      user_id: string;
      full_name_ar: string;
      branch_id: string;
      sessions_count: number;
      total_minutes: number;
      open_sessions: number;
    }) => ({
      userId: r.user_id as UUID,
      fullNameAr: r.full_name_ar,
      branchId: r.branch_id as UUID,
      branchName: branchMap.get(r.branch_id) ?? '—',
      sessionsCount: r.sessions_count,
      totalMinutes: r.total_minutes,
      openSessions: r.open_sessions,
    }),
  );
}

/* ============================== مواقع الفروع ============================== */

export async function listBranchLocations(): Promise<readonly BranchLocationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .select('id, name_ar, latitude, longitude, geofence_radius_meters')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name_ar');
  if (error) throw errors.internal(error);

  return (data ?? []).map((b) => ({
    id: b.id as UUID,
    nameAr: b.name_ar,
    latitude: b.latitude === null ? null : Number(b.latitude),
    longitude: b.longitude === null ? null : Number(b.longitude),
    radiusMeters: b.geofence_radius_meters,
  }));
}

export async function setBranchLocation(
  _ctx: AuthContext,
  input: BranchLocationInput,
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .update({
      latitude: input.latitude,
      longitude: input.longitude,
      geofence_radius_meters: input.radiusMeters,
    })
    .eq('id', input.branchId)
    .select('id')
    .maybeSingle();

  if (error) throw translate(error);
  if (!data) throw errors.permissionDenied('organizations.branches.update');
}

/* ============================== التصحيح ================================== */

/**
 * تصحيح سجل حضور.
 * ⚠️ لا يمكن لأحد تصحيح سجل نفسه — مفروض في سياسة قاعدة البيانات لا هنا.
 * ⚠️ وقت الحضور غير قابل للتعديل: تغييره يمحو الواقعة المسجّلة بالموقع.
 *    القابل للتصحيح هو الانصراف الناقص والملاحظة.
 */
export async function correctAttendance(
  _ctx: AuthContext,
  input: AttendanceCorrectionInput,
): Promise<void> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['attendance_sessions']['Update'] = {};
  if (input.checkedOutAt !== undefined) patch.checked_out_at = input.checkedOutAt;
  if (input.notes !== undefined) patch.notes = input.notes || null;

  const { data, error } = await supabase
    .from('attendance_sessions')
    .update(patch)
    .eq('id', input.id)
    .select('id')
    .maybeSingle();

  if (error) throw translate(error);
  if (!data) throw errors.permissionDenied('attendance.manage');
}

/* ================================ مساعدات ================================ */

/**
 * ⚠️ رسائل دوال الحضور مكتوبة للمستخدم النهائي («أنت خارج نطاق فرع…») ولا
 *    تكشف بنية جداول، فتُمرَّر كما هي. أي خطأ آخر يُعمَّم.
 */
function translate(error: { code?: string; message?: string }): Error {
  if (error.code === '22023' || error.code === 'P0001') {
    return errors.operationDenied(error.message ?? 'تعذّر تسجيل الحضور');
  }
  if (error.code === '42501') return errors.permissionDenied('attendance');
  if (error.code === '23505') {
    return errors.conflict('لديك جلسة حضور مفتوحة بالفعل — سجّل انصرافك أولًا');
  }
  if (error.code === '23514') {
    return errors.operationDenied('وقت الانصراف يجب أن يكون بعد وقت الحضور');
  }
  return errors.internal(error);
}

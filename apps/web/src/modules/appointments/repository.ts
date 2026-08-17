import 'server-only';

import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type {
  AppointmentCreateInput,
  AppointmentListQueryInput,
  AppointmentStatusInput,
  AppointmentUpdateInput,
  AvailabilityQueryInput,
  BusinessHoursSetInput,
} from './schemas';

/**
 * الوصول للبيانات — الحجوزات.
 *
 * ⚠️ كل استعلام بجلسة المستخدم ⇒ RLS مُطبَّق. **لا يُستخدم مفتاح الخدمة هنا
 *    إطلاقًا** ولا يُستورَد في هذا الملف: الحجز عملية مستخدم عادية، وتجاوز
 *    RLS فيها يُلغي عزل الفروع.
 * ⚠️ لا فلترة أمنية في هذه الطبقة: `branch_id` المُرسل من العميل لا يوسّع شيئًا
 *    لأن السياسة تشترط `can_access_branch` على الصف الناتج أيضًا (WITH CHECK).
 */

export interface AppointmentRow {
  id: UUID;
  referenceNo: string | null;
  branchId: UUID;
  branchName: string;
  customerId: UUID;
  customerName: string;
  customerPhone: string | null;
  serviceId: UUID | null;
  serviceName: string | null;
  providerId: UUID | null;
  providerName: string | null;
  statusId: UUID;
  statusName: string;
  statusCategory: string;
  scheduledAt: string;
  endsAt: string;
  durationMinutes: number;
  notes: string | null;
}

export interface StatusOption {
  id: UUID;
  key: string;
  nameAr: string;
  category: string;
}

export interface Option {
  id: UUID;
  nameAr: string;
}

export interface BusinessHourRow {
  id: UUID;
  weekday: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/**
 * ⚠️ نص واحد لا سلسلة مُركّبة: supabase-js يستنتج شكل الصف من **النص الحرفي**،
 *    وأي تركيب بـ `+` يُفقده الحرفية فيسقط النوع إلى خطأ عام.
 */
const APPOINTMENT_COLUMNS =
  'id, reference_no, branch_id, customer_id, service_id, provider_id, status_id, status_category, scheduled_at, ends_at, duration_minutes, notes';

type AppointmentRecord = Database['public']['Tables']['appointments']['Row'];
type SelectedAppointment = Pick<
  AppointmentRecord,
  | 'id'
  | 'reference_no'
  | 'branch_id'
  | 'customer_id'
  | 'service_id'
  | 'provider_id'
  | 'status_id'
  | 'status_category'
  | 'scheduled_at'
  | 'ends_at'
  | 'duration_minutes'
  | 'notes'
>;

/* =============================== القراءة ================================== */

export async function listAppointments(
  _ctx: AuthContext,
  input: AppointmentListQueryInput,
): Promise<Paginated<AppointmentRow>> {
  const supabase = await createClient();

  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  if (input.branchId) query = query.eq('branch_id', input.branchId);
  if (input.providerId) query = query.eq('provider_id', input.providerId);
  if (input.statusId) query = query.eq('status_id', input.statusId);
  if (input.date) {
    /*
      ⚠️ اليوم يُحسب بتوقيت الفرع لا بتوقيت الخادم. عند تحديد فرع نستخدم
         منطقته؛ وبلا فرع نستخدم نافذة تغطي كل المناطق المحتملة (±14 ساعة)
         ثم نُضيّق بعد الجلب — بدل إظهار يوم خاطئ بصمت.
    */
    const dayStart = new Date(`${input.date}T00:00:00Z`);
    const from = new Date(dayStart.getTime() - 14 * 3600_000).toISOString();
    const to = new Date(dayStart.getTime() + 38 * 3600_000).toISOString();
    query = query.gte('scheduled_at', from).lt('scheduled_at', to);
  }
  if (input.search) {
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) query = query.ilike('reference_no', `%${term}%`);
  }

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('scheduled_at', { ascending: false })
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  let items = await hydrate(data ?? []);

  // البحث بالاسم/الهاتف يتم بعد الترطيب: بيانات العميل في جدول آخر، والانضمام
  // المضمّن يتطلب علاقات في الأنواع المُولّدة.
  if (input.search) {
    const term = input.search.trim().toLowerCase();
    items = items.filter(
      (a) =>
        a.customerName.toLowerCase().includes(term) ||
        (a.customerPhone ?? '').includes(term) ||
        (a.referenceNo ?? '').toLowerCase().includes(term),
    );
  }
  if (input.date) {
    items = items.filter((a) => localDate(a.scheduledAt, a.branchTimezone) === input.date);
  }

  const total = count ?? 0;
  return {
    items: items.map(toPublicRow),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getAppointment(_ctx: AuthContext, id: string): Promise<AppointmentRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw errors.internal(error);
  if (!data) throw errors.notFound('appointment');

  const [row] = await hydrate([data]);
  if (!row) throw errors.notFound('appointment');
  return toPublicRow(row);
}

/**
 * يُسقط منطقة الفرع الزمنية قبل الخروج من الطبقة.
 * ⚠️ حقل داخلي يخدم التصفية باليوم المحلي فقط؛ لا داعي لإرساله إلى المتصفح.
 */
function toPublicRow(row: Hydrated): AppointmentRow {
  const { branchTimezone, ...rest } = row;
  void branchTimezone;
  return rest;
}

/** اليوم المحلي لفرع من لحظة مطلقة — لا يعتمد على توقيت الخادم. */
function localDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

type Hydrated = AppointmentRow & { branchTimezone: string };

/**
 * يجلب الأسماء المرتبطة في استعلامات مُجمَّعة.
 * ⚠️ كلها بجلسة المستخدم ⇒ ما لا يراه المستخدم يظهر «—» لا بيانات مسرّبة.
 */
async function hydrate(rows: readonly SelectedAppointment[]): Promise<Hydrated[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();

  const ids = <T,>(list: readonly (T | null)[]): T[] => [
    ...new Set(list.filter((v): v is T => v !== null)),
  ];

  const [branches, customers, services, providers, statuses] = await Promise.all([
    supabase.from('branches').select('id, name_ar, timezone').in('id', ids(rows.map((r) => r.branch_id))),
    supabase.from('customers').select('id, full_name_ar, phone').in('id', ids(rows.map((r) => r.customer_id))),
    supabase.from('services').select('id, name_ar').in('id', ids(rows.map((r) => r.service_id))),
    supabase
      .from('service_providers')
      .select('id, full_name_ar')
      .in('id', ids(rows.map((r) => r.provider_id))),
    supabase.from('appointment_statuses').select('id, name_ar').in('id', ids(rows.map((r) => r.status_id))),
  ]);

  const branchMap = new Map((branches.data ?? []).map((b) => [b.id, b]));
  const customerMap = new Map((customers.data ?? []).map((c) => [c.id, c]));
  const serviceMap = new Map((services.data ?? []).map((s) => [s.id, s.name_ar]));
  const providerMap = new Map((providers.data ?? []).map((p) => [p.id, p.full_name_ar]));
  const statusMap = new Map((statuses.data ?? []).map((s) => [s.id, s.name_ar]));

  return rows.map((r) => {
    const branch = branchMap.get(r.branch_id);
    const customer = customerMap.get(r.customer_id);
    return {
      id: r.id as UUID,
      referenceNo: r.reference_no,
      branchId: r.branch_id as UUID,
      branchName: branch?.name_ar ?? '—',
      branchTimezone: branch?.timezone ?? 'Asia/Riyadh',
      customerId: r.customer_id as UUID,
      customerName: customer?.full_name_ar ?? '—',
      customerPhone: customer?.phone ?? null,
      serviceId: r.service_id as UUID | null,
      serviceName: r.service_id ? (serviceMap.get(r.service_id) ?? '—') : null,
      providerId: r.provider_id as UUID | null,
      providerName: r.provider_id ? (providerMap.get(r.provider_id) ?? '—') : null,
      statusId: r.status_id as UUID,
      statusName: statusMap.get(r.status_id) ?? '—',
      statusCategory: r.status_category,
      scheduledAt: r.scheduled_at,
      endsAt: r.ends_at,
      durationMinutes: r.duration_minutes,
      notes: r.notes,
    };
  });
}

/* =============================== الكتابة ================================== */

type AppointmentInsert = Database['public']['Tables']['appointments']['Insert'];

export async function createAppointment(
  ctx: AuthContext,
  input: AppointmentCreateInput,
): Promise<{ id: UUID }> {
  const supabase = await createClient();

  /*
    ⚠️ `ends_at` مُستبعَد بـ Omit عمدًا.

    العمود NOT NULL بلا افتراضي، فالأنواع المُولّدة تعتبره مطلوبًا من العميل.
    لكنه في الواقع يكتبه محفّز BEFORE INSERT من `scheduled_at` والمدة، ويتجاهل
    أي قيمة مُرسَلة. إرسال قيمة صورية لإرضاء المُدقّق كان سيكون تصريحًا كاذبًا
    في الكود، وإضافة افتراضي في المخطط كانت ستضع قيمة بلا معنى في العمود.
    الاستبعاد هنا هو الوصف الصادق: التطبيق لا يزوّد هذا العمود.

    ⚠️ `duration_minutes` كذلك يُشتق من الخدمة في المحفّز (له افتراضي فهو اختياري).
    ⚠️ `reference_no` غير مذكور: صيغة الترقيم قرار عمل غير معتمد.
  */
  const payload: Omit<AppointmentInsert, 'ends_at'> = {
    organization_id: ctx.organizationId, // من الجلسة لا من العميل
    branch_id: input.branchId,
    customer_id: input.customerId,
    service_id: input.serviceId,
    provider_id: input.providerId,
    status_id: input.statusId,
    scheduled_at: input.scheduledAt,
    notes: input.notes || null,
  };

  const { data, error } = await supabase
    .from('appointments')
    .insert(payload as AppointmentInsert)
    .select('id')
    .single();

  if (error) throw translateError(error);
  return { id: data.id as UUID };
}

export async function updateAppointment(
  _ctx: AuthContext,
  input: AppointmentUpdateInput,
): Promise<void> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['appointments']['Update'] = {};
  if (input.serviceId !== undefined) patch.service_id = input.serviceId;
  if (input.providerId !== undefined) patch.provider_id = input.providerId;
  if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt;
  if (input.notes !== undefined) patch.notes = input.notes || null;

  const { data, error } = await supabase
    .from('appointments')
    .update(patch)
    .eq('id', input.id)
    .select('id')
    .maybeSingle();

  if (error) throw translateError(error);
  if (!data) throw errors.permissionDenied('appointments.update');
}

/**
 * تغيير الحالة.
 * ⚠️ الصلاحية المطلوبة تُقرَّر في طبقة الأفعال: الإلغاء يستخدم
 *    `appointments.cancel` وغيره `appointments.update` — وهما موجودتان أصلًا.
 */
export async function setAppointmentStatus(
  _ctx: AuthContext,
  input: AppointmentStatusInput,
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    .update({ status_id: input.statusId })
    .eq('id', input.id)
    .select('id')
    .maybeSingle();

  if (error) throw translateError(error);
  if (!data) throw errors.permissionDenied('appointments.update');
}

/* ============================ الأوقات المتاحة ============================= */

/**
 * الأوقات المتاحة — تُحسب في المحرّك لا هنا.
 * ⚠️ تكرار المنطق في الواجهة يُنتج شاشة تعرض وقتًا ترفضه قاعدة البيانات.
 */
export async function listAvailableSlots(
  _ctx: AuthContext,
  input: AvailabilityQueryInput,
): Promise<readonly string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('available_slots', {
    p_branch: input.branchId,
    p_service: input.serviceId,
    p_provider: input.providerId,
    p_date: input.date,
  });
  if (error) throw translateError(error);
  return (data ?? []).map((row: { slot_start: string }) => row.slot_start);
}

/* =============================== الخيارات ================================= */

export async function listStatusOptions(): Promise<readonly StatusOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('appointment_statuses')
    .select('id, key, name_ar, category')
    .eq('is_active', true)
    .order('sort_order');
  return (data ?? []).map((s) => ({
    id: s.id as UUID,
    key: s.key,
    nameAr: s.name_ar,
    category: s.category,
  }));
}

/** الفروع التي يصلها المستخدم — RLS تتكفّل بالتقييد. */
export async function listBranchOptions(): Promise<readonly Option[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branches')
    .select('id, name_ar')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name_ar');
  return (data ?? []).map((b) => ({ id: b.id as UUID, nameAr: b.name_ar }));
}

/** الخدمات النشطة المتاحة فعلًا في فرع محدد. */
export async function listServiceOptions(branchId: string): Promise<readonly Option[]> {
  const supabase = await createClient();

  const { data: links } = await supabase
    .from('branch_services')
    .select('service_id')
    .eq('branch_id', branchId)
    .eq('is_available', true);

  const linkedIds = (links ?? []).map((l) => l.service_id);

  // خدمة خاصة بالفرع متاحة فيه بحكم انتمائها، ولا تحتاج صف ربط
  const { data } = await supabase
    .from('services')
    .select('id, name_ar, branch_id, default_duration_minutes')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name_ar');

  return (data ?? [])
    .filter(
      (s) =>
        // بلا مدة افتراضية لا يمكن حساب الأوقات ⇒ لا تُعرض للحجز
        s.default_duration_minutes !== null &&
        (s.branch_id === branchId || (s.branch_id === null && linkedIds.includes(s.id))),
    )
    .map((s) => ({ id: s.id as UUID, nameAr: s.name_ar }));
}

/**
 * مقدّمو الخدمة المتاحون لخدمة في فرع.
 * ⚠️ نفس الشروط التي يفرضها محفّز التحقق حرفيًا — وإلا عرضت الشاشة مقدّمًا
 *    يرفضه المحرّك عند الحفظ.
 */
export async function listProviderOptions(
  branchId: string,
  serviceId: string,
): Promise<readonly Option[]> {
  const supabase = await createClient();

  const { data: capable } = await supabase
    .from('provider_services')
    .select('provider_id')
    .eq('service_id', serviceId)
    .eq('is_available', true);

  const capableIds = (capable ?? []).map((c) => c.provider_id);
  if (capableIds.length === 0) return [];

  const { data: orgWide } = await supabase
    .from('provider_branches')
    .select('provider_id')
    .eq('branch_id', branchId);
  const orgWideIds = new Set((orgWide ?? []).map((p) => p.provider_id));

  const { data } = await supabase
    .from('service_providers')
    .select('id, full_name_ar, branch_id')
    .in('id', capableIds)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('full_name_ar');

  return (data ?? [])
    .filter((p) => (p.branch_id === null ? orgWideIds.has(p.id) : p.branch_id === branchId))
    .map((p) => ({ id: p.id as UUID, nameAr: p.full_name_ar }));
}

/** عملاء الفرع — للبحث في نموذج الحجز. */
export async function listCustomerOptions(
  branchId: string,
  search: string,
): Promise<ReadonlyArray<Option & { phone: string | null }>> {
  const supabase = await createClient();
  let query = supabase
    .from('customers')
    .select('id, full_name_ar, phone')
    .eq('branch_id', branchId)
    .is('deleted_at', null);

  const term = search.replace(/[(),%*]/g, ' ').trim();
  if (term) query = query.or(`full_name_ar.ilike.%${term}%,phone.ilike.%${term}%`);

  const { data } = await query.order('full_name_ar').limit(20);
  return (data ?? []).map((c) => ({
    id: c.id as UUID,
    nameAr: c.full_name_ar,
    phone: c.phone,
  }));
}

/* ============================== ساعات العمل =============================== */

export async function listBusinessHours(branchId: string): Promise<readonly BusinessHourRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('business_hours')
    .select('id, weekday, opens_at, closes_at, is_closed')
    .eq('branch_id', branchId)
    .order('weekday')
    .order('opens_at');
  if (error) throw errors.internal(error);

  return (data ?? []).map((h) => ({
    id: h.id as UUID,
    weekday: h.weekday,
    opensAt: String(h.opens_at).slice(0, 5),
    closesAt: String(h.closes_at).slice(0, 5),
    isClosed: h.is_closed,
  }));
}

/**
 * استبدال ساعات عمل الفرع.
 *
 * ⚠️ ليست ذرية: الحذف والإدراج نداءان على PostgREST. النتيجة الوسطى هي
 *    «فرع بلا ساعات» أي **لا حجز جديد** — الفشل يتجه نحو المنع لا نحو
 *    السماح. الحجوزات القائمة لا تتأثر: التحقق يجري عند الكتابة لا القراءة.
 */
export async function setBusinessHours(
  ctx: AuthContext,
  input: BusinessHoursSetInput,
): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from('business_hours')
    .delete()
    .eq('branch_id', input.branchId);
  if (deleteError) throw translateError(deleteError);

  if (input.periods.length === 0) return;

  const { error } = await supabase.from('business_hours').insert(
    input.periods.map((p) => ({
      organization_id: ctx.organizationId,
      branch_id: input.branchId,
      weekday: p.weekday,
      opens_at: p.opensAt,
      closes_at: p.closesAt,
      is_closed: p.isClosed,
    })),
  );
  if (error) throw translateError(error);
}

/* ================================ مساعدات ================================= */

/**
 * يحوّل أخطاء المحرّك إلى أخطاء تطبيق مفهومة.
 *
 * ⚠️ `23P01` هو رمز انتهاك قيد الاستبعاد — أي تعارض مواعيد. الرسالة الخام
 *    تكشف اسم القيد وقيم المدى، فنستبدلها برسالة تشغيلية.
 */
function translateError(error: { code?: string; message?: string }): Error {
  if (error.code === '23P01') {
    return errors.conflict('هذا الوقت محجوز لمقدّم الخدمة — اختر وقتًا آخر');
  }
  if (error.code === '42501') {
    return errors.permissionDenied('appointments');
  }
  if (error.code === '22023' || error.code === 'P0001') {
    // رسائل محفّز التحقق مكتوبة للمستخدم النهائي ولا تكشف بنية جداول
    return errors.operationDenied(error.message ?? 'تعذّر حفظ الحجز');
  }
  if (error.code === '23505') {
    return errors.conflict('يوجد حجز بنفس الرقم المرجعي');
  }
  return errors.internal(error);
}

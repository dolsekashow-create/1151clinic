import 'server-only';

import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type {
  ListQueryInput,
  ProviderBranchesSetInput,
  ProviderCreateInput,
  ProviderServicesSetInput,
  ProviderUpdateInput,
  ServiceBranchesSetInput,
  ServiceCreateInput,
  ServiceUpdateInput,
} from './schemas';

/**
 * الوصول للبيانات — الخدمات ومقدّمو الخدمة.
 * ⚠️ كل الاستعلامات بجلسة المستخدم ⇒ RLS مُطبَّق.
 */

export interface ServiceRow {
  id: UUID;
  code: string;
  nameAr: string;
  description: string | null;
  durationMinutes: number | null;
  branchId: UUID | null;
  status: string;
  isPublic: boolean;
}

export interface ProviderRow {
  id: UUID;
  code: string;
  nameAr: string;
  specialty: string | null;
  /*
    الهاتف والبريد بيانات داخلية للموظفين.
    ⚠️ محجوبان عن `anon` على مستوى **أعمدة** قاعدة البيانات لا بالاختيار هنا،
       فلا يكشفهما أي استعلام عام مهما كان. تحميلهما هنا ضروري: نموذج التعديل
       بلا قيمة حالية يُرسل فراغًا فيمحو البيانات القائمة بصمت.
  */
  phone: string | null;
  email: string | null;
  branchId: UUID | null;
  /** null = مقدّم خدمة بلا حساب مستخدم (RQ-02) */
  profileId: UUID | null;
  status: string;
  isPublic: boolean;
}

const SERVICE_COLUMNS =
  'id, code, name_ar, description, default_duration_minutes, branch_id, status, is_public';
const PROVIDER_COLUMNS =
  'id, code, full_name_ar, specialty, phone, email, branch_id, profile_id, status, is_public';

type ServiceRecord = Database['public']['Tables']['services']['Row'];
type ProviderRecord = Database['public']['Tables']['service_providers']['Row'];

function toService(
  r: Pick<ServiceRecord, 'id' | 'code' | 'name_ar' | 'description' | 'default_duration_minutes' | 'branch_id' | 'status' | 'is_public'>,
): ServiceRow {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    description: r.description,
    durationMinutes: r.default_duration_minutes,
    branchId: r.branch_id,
    status: r.status,
    isPublic: r.is_public,
  };
}

function toProvider(
  r: Pick<ProviderRecord, 'id' | 'code' | 'full_name_ar' | 'specialty' | 'phone' | 'email' | 'branch_id' | 'profile_id' | 'status' | 'is_public'>,
): ProviderRow {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.full_name_ar,
    specialty: r.specialty,
    phone: r.phone,
    email: r.email,
    branchId: r.branch_id,
    profileId: r.profile_id,
    status: r.status,
    isPublic: r.is_public,
  };
}

function applyListFilters<T>(
  query: T,
  input: ListQueryInput,
  searchColumns: string,
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (input.status) q = q.eq('status', input.status);
  if (input.isPublic) q = q.eq('is_public', input.isPublic === 'true');
  if (input.search) {
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) {
      q = q.or(
        searchColumns
          .split(',')
          .map((c) => `${c.trim()}.ilike.%${term}%`)
          .join(','),
      );
    }
  }
  return q as T;
}

/* ------------------------------- الخدمات ---------------------------------- */

export async function listServices(
  _ctx: AuthContext,
  input: ListQueryInput,
): Promise<Paginated<ServiceRow>> {
  const supabase = await createClient();
  const base = supabase
    .from('services')
    .select(SERVICE_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  const query = applyListFilters(base, input, 'name_ar, code');
  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query.order('name_ar').range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const total = count ?? 0;
  return {
    items: (data ?? []).map(toService),
    meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function createService(ctx: AuthContext, input: ServiceCreateInput): Promise<ServiceRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .insert({
      organization_id: ctx.organizationId,
      branch_id: input.branchId ?? null,
      code: input.code,
      name_ar: input.nameAr,
      name_en: input.nameEn || null,
      description: input.description || null,
      default_duration_minutes: input.durationMinutes ?? null,
    })
    .select(SERVICE_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد خدمة بنفس الكود', { code: input.code });
    if (error.code === '42501') throw errors.permissionDenied('services.create');
    throw errors.internal(error);
  }
  return toService(data);
}

export async function updateService(_ctx: AuthContext, input: ServiceUpdateInput): Promise<ServiceRow> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['services']['Update'] = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
  if (input.nameEn !== undefined) patch.name_en = input.nameEn || null;
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.durationMinutes !== undefined) patch.default_duration_minutes = input.durationMinutes;
  if (input.status !== undefined) patch.status = input.status;
  // ⚠️ is_public و branch_id غير قابلين للتعديل من هنا

  const { data, error } = await supabase
    .from('services')
    .update(patch)
    .eq('id', input.id)
    .select(SERVICE_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد خدمة بنفس الكود');
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('service');
  return toService(data);
}

export async function setServicePublish(
  _ctx: AuthContext,
  id: UUID,
  isPublic: boolean,
): Promise<ServiceRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .update({ is_public: isPublic })
    .eq('id', id)
    .select(SERVICE_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message.includes('صلاحية')) {
      throw errors.permissionDenied('services.publish');
    }
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('service');
  return toService(data);
}

/* --------------------------- مقدّمو الخدمة -------------------------------- */

export async function listProviders(
  _ctx: AuthContext,
  input: ListQueryInput,
): Promise<Paginated<ProviderRow>> {
  const supabase = await createClient();
  const base = supabase
    .from('service_providers')
    .select(PROVIDER_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  const query = applyListFilters(base, input, 'full_name_ar, code, specialty');
  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('full_name_ar')
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const total = count ?? 0;
  return {
    items: (data ?? []).map(toProvider),
    meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function createProvider(
  ctx: AuthContext,
  input: ProviderCreateInput,
): Promise<ProviderRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_providers')
    .insert({
      organization_id: ctx.organizationId,
      branch_id: input.branchId ?? null,
      code: input.code,
      full_name_ar: input.nameAr,
      full_name_en: input.nameEn || null,
      specialty: input.specialty || null,
      phone: input.phone || null,
      email: input.email || null,
      notes: input.notes || null,
      // ⚠️ profile_id يبقى null — ربط الحساب فعل منفصل (RQ-02: الحساب اختياري)
    })
    .select(PROVIDER_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد مقدّم خدمة بنفس الكود', { code: input.code });
    if (error.code === '42501') throw errors.permissionDenied('services.providers.manage');
    throw errors.internal(error);
  }
  return toProvider(data);
}

export async function updateProvider(
  _ctx: AuthContext,
  input: ProviderUpdateInput,
): Promise<ProviderRow> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['service_providers']['Update'] = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.nameAr !== undefined) patch.full_name_ar = input.nameAr;
  if (input.nameEn !== undefined) patch.full_name_en = input.nameEn || null;
  if (input.specialty !== undefined) patch.specialty = input.specialty || null;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.email !== undefined) patch.email = input.email || null;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from('service_providers')
    .update(patch)
    .eq('id', input.id)
    .select(PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد مقدّم خدمة بنفس الكود');
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('service_provider');
  return toProvider(data);
}

export async function setProviderPublish(
  _ctx: AuthContext,
  id: UUID,
  isPublic: boolean,
): Promise<ProviderRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_providers')
    .update({ is_public: isPublic })
    .eq('id', id)
    .select(PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message.includes('صلاحية')) {
      throw errors.permissionDenied('services.providers.publish');
    }
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('service_provider');
  return toProvider(data);
}

/* ============================== جداول الربط ============================== */

/**
 * إتاحة مقدّم الخدمة والخدمات في الفروع.
 *
 * ⚠️ الاستبدال (حذف ثم إدراج) ليس ذريًا: نداءان على PostgREST. الحالة الوسطى
 *    هي «لا ربط» أي **غير متاح** — الفشل يتجه نحو المنع لا نحو الإتاحة، وهو
 *    الاتجاه الآمن هنا. الحجوزات القائمة لا تتأثر: التحقق يجري عند الكتابة.
 * ⚠️ كل الاستعلامات بجلسة المستخدم ⇒ RLS تمنع الربط بفرع خارج نطاقه.
 */

export interface LinkState {
  id: UUID;
  nameAr: string;
  linked: boolean;
}

/** الفروع مع حالة ربطها بمقدّم خدمة. */
export async function listProviderBranchState(providerId: string): Promise<readonly LinkState[]> {
  const supabase = await createClient();
  const [branches, links] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name_ar')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('name_ar'),
    supabase.from('provider_branches').select('branch_id').eq('provider_id', providerId),
  ]);

  const linked = new Set((links.data ?? []).map((l) => l.branch_id));
  return (branches.data ?? []).map((b) => ({
    id: b.id as UUID,
    nameAr: b.name_ar,
    linked: linked.has(b.id),
  }));
}

export async function setProviderBranches(
  _ctx: AuthContext,
  input: ProviderBranchesSetInput,
): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from('provider_branches')
    .delete()
    .eq('provider_id', input.providerId);
  if (deleteError) throw translateLinkError(deleteError, 'services.providers.manage');

  if (input.branchIds.length === 0) return;

  const { error } = await supabase.from('provider_branches').insert(
    input.branchIds.map((branchId, index) => ({
      provider_id: input.providerId,
      branch_id: branchId,
      is_primary: index === 0,
    })),
  );
  if (error) throw translateLinkError(error, 'services.providers.manage');
}

/** الخدمات مع حالة ربطها بمقدّم خدمة. */
export async function listProviderServiceState(providerId: string): Promise<readonly LinkState[]> {
  const supabase = await createClient();
  const [services, links] = await Promise.all([
    supabase
      .from('services')
      .select('id, name_ar')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('name_ar'),
    supabase.from('provider_services').select('service_id').eq('provider_id', providerId),
  ]);

  const linked = new Set((links.data ?? []).map((l) => l.service_id));
  return (services.data ?? []).map((s) => ({
    id: s.id as UUID,
    nameAr: s.name_ar,
    linked: linked.has(s.id),
  }));
}

export async function setProviderServices(
  _ctx: AuthContext,
  input: ProviderServicesSetInput,
): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from('provider_services')
    .delete()
    .eq('provider_id', input.providerId);
  if (deleteError) throw translateLinkError(deleteError, 'services.providers.manage');

  if (input.serviceIds.length === 0) return;

  const { error } = await supabase.from('provider_services').insert(
    input.serviceIds.map((serviceId) => ({
      provider_id: input.providerId,
      service_id: serviceId,
      is_available: true,
    })),
  );
  if (error) throw translateLinkError(error, 'services.providers.manage');
}

/** الفروع مع حالة إتاحة خدمة فيها. */
export async function listServiceBranchState(serviceId: string): Promise<readonly LinkState[]> {
  const supabase = await createClient();
  const [branches, links] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name_ar')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('name_ar'),
    supabase.from('branch_services').select('branch_id').eq('service_id', serviceId),
  ]);

  const linked = new Set((links.data ?? []).map((l) => l.branch_id));
  return (branches.data ?? []).map((b) => ({
    id: b.id as UUID,
    nameAr: b.name_ar,
    linked: linked.has(b.id),
  }));
}

export async function setServiceBranches(
  _ctx: AuthContext,
  input: ServiceBranchesSetInput,
): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from('branch_services')
    .delete()
    .eq('service_id', input.serviceId);
  if (deleteError) throw translateLinkError(deleteError, 'services.update');

  if (input.branchIds.length === 0) return;

  const { error } = await supabase.from('branch_services').insert(
    input.branchIds.map((branchId) => ({
      branch_id: branchId,
      service_id: input.serviceId,
      is_available: true,
    })),
  );
  if (error) throw translateLinkError(error, 'services.update');
}

/**
 * ⚠️ RLS ترفض الربط بفرع خارج النطاق بـ 42501 لا بصفر صفوف، لأن الإدراج
 *    يفشل صراحةً عند مخالفة WITH CHECK. نحوّله إلى رسالة مفهومة.
 */
function translateLinkError(error: { code?: string; message?: string }, permission: string): Error {
  if (error.code === '42501') return errors.permissionDenied(permission);
  if (error.code === '23503') {
    return errors.operationDenied('العنصر المطلوب ربطه غير موجود أو خارج نطاقك');
  }
  return errors.internal(error);
}

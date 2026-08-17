import 'server-only';

import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors, resolveBranchFilter } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type { CustomerCreateInput, CustomerListInput, CustomerUpdateInput } from './schemas';

/**
 * طبقة الوصول للبيانات لوحدة العملاء.
 *
 * ⚠️ كل الاستعلامات تمر بعميل الخادم العامل بجلسة المستخدم ⇒ RLS مُطبَّق.
 *    الفلاتر أدناه ليست حماية — هي تحسين استعلام وتوضيح نية؛ الحماية في RLS.
 */

export interface CustomerRow {
  id: UUID;
  code: string | null;
  fullNameAr: string;
  phone: string;
  email: string | null;
  status: string;
  branchId: UUID;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** تحويل snake_case ← camelCase يحدث هنا فقط (docs/API.md §5). */
function toRow(record: {
  id: string;
  code: string | null;
  full_name_ar: string;
  phone: string;
  email: string | null;
  status: string;
  branch_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}): CustomerRow {
  return {
    id: record.id,
    code: record.code,
    fullNameAr: record.full_name_ar,
    phone: record.phone,
    email: record.email,
    status: record.status,
    branchId: record.branch_id,
    notes: record.notes,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const SELECT_COLUMNS =
  'id, code, full_name_ar, phone, email, status, branch_id, notes, created_at, updated_at';

export async function listCustomers(
  ctx: AuthContext,
  input: CustomerListInput,
): Promise<Paginated<CustomerRow>> {
  const supabase = await createClient();
  const branchFilter = resolveBranchFilter(ctx, input.branchId ?? null);

  let query = supabase
    .from('customers')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  if (branchFilter !== null) {
    // نطاق فرع: لو كانت القائمة فارغة فالمستخدم بلا فروع ⇒ لا نتائج
    if (branchFilter.length === 0) {
      return { items: [], meta: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 } };
    }
    query = query.in('branch_id', branchFilter as string[]);
  }

  if (input.status) query = query.eq('status', input.status);

  if (input.search) {
    // البحث على الاسم أو الهاتف. الحروف الخاصة تُنقّى لأن or() يبني تعبيرًا نصيًا.
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) {
      query = query.or(`full_name_ar.ilike.%${term}%,phone.ilike.%${term}%,code.ilike.%${term}%`);
    }
  }

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order(input.sortBy, { ascending: input.sortDir === 'asc' })
    .range(from, from + input.pageSize - 1);

  if (error) throw errors.internal(error);

  const total = count ?? 0;
  return {
    items: (data ?? []).map(toRow),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function createCustomer(
  ctx: AuthContext,
  input: CustomerCreateInput,
): Promise<CustomerRow> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('customers')
    .insert({
      // ⚠️ من الجلسة — لا من العميل
      organization_id: ctx.organizationId,
      branch_id: input.branchId,
      full_name_ar: input.fullNameAr,
      full_name_en: input.fullNameEn || null,
      phone: input.phone,
      email: input.email || null,
      gender: input.gender ?? null,
      code: input.code || null,
      notes: input.notes || null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw errors.conflict('يوجد عميل مسجّل بنفس رقم الهاتف أو الكود', { phone: input.phone });
    }
    // 42501 = انتهاك سياسة RLS: المستخدم خارج نطاق الفرع المطلوب
    if (error.code === '42501') throw errors.branchAccessDenied(input.branchId);
    throw errors.internal(error);
  }

  return toRow(data);
}

export async function updateCustomer(
  ctx: AuthContext,
  input: CustomerUpdateInput,
): Promise<CustomerRow> {
  const supabase = await createClient();

  // نوع التحديث مشتق من الجدول ⇒ أي عمود غير موجود يُرفض عند الترجمة
  const patch: Database['public']['Tables']['customers']['Update'] = {};
  if (input.fullNameAr !== undefined) patch.full_name_ar = input.fullNameAr;
  if (input.fullNameEn !== undefined) patch.full_name_en = input.fullNameEn || null;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email || null;
  if (input.gender !== undefined) patch.gender = input.gender ?? null;
  if (input.code !== undefined) patch.code = input.code || null;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  if (input.status !== undefined) patch.status = input.status;
  // ⚠️ branch_id غير قابل للتعديل من هنا: نقل عميل بين الفروع عملية منفصلة
  //    تحتاج قاعدة عمل معتمدة، و RLS يرفضها أصلًا عبر WITH CHECK.

  if (Object.keys(patch).length === 0) {
    const existing = await getCustomer(ctx, input.id);
    if (!existing) throw errors.notFound('customer');
    return existing;
  }

  const { data, error } = await supabase
    .from('customers')
    .update(patch)
    .eq('id', input.id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد عميل مسجّل بنفس رقم الهاتف أو الكود');
    throw errors.internal(error);
  }
  // لا صف ⇒ إما غير موجود أو خارج نطاق المستخدم. لا نميّز بينهما للمستخدم
  // حتى لا نكشف وجود سجلات في فروع أخرى.
  if (!data) throw errors.notFound('customer');

  return toRow(data);
}

export async function getCustomer(_ctx: AuthContext, id: UUID): Promise<CustomerRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw errors.internal(error);
  return data ? toRow(data) : null;
}

/** حذف ناعم — السجل يبقى للتدقيق والتقارير. */
export async function softDeleteCustomer(_ctx: AuthContext, id: UUID): Promise<void> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) throw errors.internal(error);
  if (!count) throw errors.notFound('customer');
}

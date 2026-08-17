import 'server-only';

import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type {
  BranchCreateInput,
  BranchUpdateInput,
  DepartmentCreateInput,
  DepartmentUpdateInput,
  ListQueryInput,
  OrganizationUpdateInput,
} from './schemas';

/**
 * الوصول للبيانات — الفروع والأقسام.
 * ⚠️ كل الاستعلامات بجلسة المستخدم ⇒ RLS مُطبَّق. الفلاتر تحسين لا حماية.
 */

export interface BranchRow {
  id: UUID;
  code: string;
  nameAr: string;
  nameEn: string | null;
  city: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  status: string;
  isPublic: boolean;
}

export interface DepartmentRow {
  id: UUID;
  code: string;
  nameAr: string;
  branchId: UUID | null;
  parentId: UUID | null;
  status: string;
}

const BRANCH_COLUMNS =
  'id, code, name_ar, name_en, city, phone, address, timezone, status, is_public';
const DEPARTMENT_COLUMNS = 'id, code, name_ar, branch_id, parent_id, status';

type BranchRecord = Database['public']['Tables']['branches']['Row'];
type DepartmentRecord = Database['public']['Tables']['departments']['Row'];

function toBranch(r: Pick<BranchRecord, 'id' | 'code' | 'name_ar' | 'name_en' | 'city' | 'phone' | 'address' | 'timezone' | 'status' | 'is_public'>): BranchRow {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    city: r.city,
    phone: r.phone,
    address: r.address,
    timezone: r.timezone,
    status: r.status,
    isPublic: r.is_public,
  };
}

function toDepartment(r: Pick<DepartmentRecord, 'id' | 'code' | 'name_ar' | 'branch_id' | 'parent_id' | 'status'>): DepartmentRow {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    branchId: r.branch_id,
    parentId: r.parent_id,
    status: r.status,
  };
}

/* -------------------------------- الفروع ---------------------------------- */

export async function listBranches(
  _ctx: AuthContext,
  input: ListQueryInput,
): Promise<Paginated<BranchRow>> {
  const supabase = await createClient();
  let query = supabase
    .from('branches')
    .select(BRANCH_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  if (input.status) query = query.eq('status', input.status);
  if (input.isPublic) query = query.eq('is_public', input.isPublic === 'true');
  if (input.search) {
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) query = query.or(`name_ar.ilike.%${term}%,code.ilike.%${term}%,city.ilike.%${term}%`);
  }

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('code')
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const total = count ?? 0;
  return {
    items: (data ?? []).map(toBranch),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function createBranch(ctx: AuthContext, input: BranchCreateInput): Promise<BranchRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .insert({
      organization_id: ctx.organizationId, // من الجلسة لا من العميل
      code: input.code,
      name_ar: input.nameAr,
      name_en: input.nameEn || null,
      city: input.city || null,
      phone: input.phone || null,
      address: input.address || null,
      timezone: input.timezone,
      // is_public يبقى false — النشر فعل منفصل بصلاحية منفصلة
    })
    .select(BRANCH_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد فرع بنفس الكود', { code: input.code });
    if (error.code === '42501') throw errors.permissionDenied('organizations.branches.create');
    throw errors.internal(error);
  }
  return toBranch(data);
}

export async function updateBranch(_ctx: AuthContext, input: BranchUpdateInput): Promise<BranchRow> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['branches']['Update'] = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
  if (input.nameEn !== undefined) patch.name_en = input.nameEn || null;
  if (input.city !== undefined) patch.city = input.city || null;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.address !== undefined) patch.address = input.address || null;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.status !== undefined) patch.status = input.status;
  // ⚠️ is_public غير مذكور عمدًا — يُغيَّر عبر setBranchPublish فقط

  const { data, error } = await supabase
    .from('branches')
    .update(patch)
    .eq('id', input.id)
    .select(BRANCH_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد فرع بنفس الكود');
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('branch');
  return toBranch(data);
}

/**
 * تغيير حالة النشر.
 * ⚠️ الصلاحية تُفحص في طبقة الفعل **و** يفرضها محفّز في قاعدة البيانات
 *    (`branches_guard_publish`) — فلا يمكن تجاوزها باستدعاء مباشر لـ PostgREST.
 */
export async function setBranchPublish(
  _ctx: AuthContext,
  id: UUID,
  isPublic: boolean,
): Promise<BranchRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .update({ is_public: isPublic })
    .eq('id', id)
    .select(BRANCH_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message.includes('صلاحية')) {
      throw errors.permissionDenied('organizations.branches.publish');
    }
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('branch');
  return toBranch(data);
}

/* ---------------------------- إعدادات المنشأة ----------------------------- */

export interface OrganizationRow {
  id: UUID;
  code: string;
  nameAr: string;
  nameEn: string | null;
  status: string;
  isPublic: boolean;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  aboutAr: string | null;
}

/** مفاتيح `settings` المعروفة — أي مفتاح آخر يُترك كما هو ولا يُقرأ. */
interface OrganizationSettings {
  contactPhone?: string;
  contactEmail?: string;
  website?: string;
  aboutAr?: string;
}

function readSettings(value: unknown): OrganizationSettings {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as OrganizationSettings)
    : {};
}

export async function getOrganization(ctx: AuthContext): Promise<OrganizationRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('id, code, name_ar, name_en, status, is_public, settings')
    .eq('id', ctx.organizationId)
    .maybeSingle();

  if (error) throw errors.internal(error);
  if (!data) throw errors.notFound('organization');

  const settings = readSettings(data.settings);
  return {
    id: data.id as UUID,
    code: data.code,
    nameAr: data.name_ar,
    nameEn: data.name_en,
    status: data.status,
    isPublic: data.is_public,
    contactPhone: settings.contactPhone ?? null,
    contactEmail: settings.contactEmail ?? null,
    website: settings.website ?? null,
    aboutAr: settings.aboutAr ?? null,
  };
}

/**
 * تعديل بيانات المنشأة.
 *
 * ⚠️ `settings` تُدمج لا تُستبدل: الاستبدال يمحو أي مفتاح أضافته وحدة أخرى
 *    لاحقًا بلا أن يلاحظه أحد. نقرأ الحالي، نُحدّث المفاتيح المعروفة وحدها.
 * ⚠️ `code` و `status` و `is_public` غير قابلة للتعديل من هنا — الأول مفتاح
 *    طبيعي، والأخير فعل منفصل بصلاحية منفصلة ومحفّز يفرضها.
 */
export async function updateOrganization(
  ctx: AuthContext,
  input: OrganizationUpdateInput,
): Promise<OrganizationRow> {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', ctx.organizationId)
    .maybeSingle();
  if (readError) throw errors.internal(readError);
  if (!current) throw errors.notFound('organization');

  const merged = {
    ...readSettings(current.settings),
    contactPhone: input.contactPhone || undefined,
    contactEmail: input.contactEmail || undefined,
    website: input.website || undefined,
    aboutAr: input.aboutAr || undefined,
  };

  const { data, error } = await supabase
    .from('organizations')
    .update({
      name_ar: input.nameAr,
      name_en: input.nameEn || null,
      settings: merged,
    })
    .eq('id', ctx.organizationId)
    .select('id, code, name_ar, name_en, status, is_public, settings')
    .maybeSingle();

  if (error) {
    if (error.code === '42501') throw errors.permissionDenied('organizations.organization.update');
    throw errors.internal(error);
  }
  // RLS تُطابق صفر صفوف بصمت عند الرفض — نحوّله إلى خطأ صريح
  if (!data) throw errors.permissionDenied('organizations.organization.update');

  const settings = readSettings(data.settings);
  return {
    id: data.id as UUID,
    code: data.code,
    nameAr: data.name_ar,
    nameEn: data.name_en,
    status: data.status,
    isPublic: data.is_public,
    contactPhone: settings.contactPhone ?? null,
    contactEmail: settings.contactEmail ?? null,
    website: settings.website ?? null,
    aboutAr: settings.aboutAr ?? null,
  };
}

/**
 * نشر/إخفاء المنشأة — **البوابة العليا** للموقع العام.
 * إخفاؤها يُخفي كل الفروع والخدمات والأطباء دفعةً واحدة مهما كانت حالتهم.
 */
export async function setOrganizationPublish(
  ctx: AuthContext,
  isPublic: boolean,
): Promise<{ isPublic: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organizations')
    .update({ is_public: isPublic })
    .eq('id', ctx.organizationId)
    .select('is_public')
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message.includes('صلاحية')) {
      throw errors.permissionDenied('organizations.organization.publish');
    }
    throw errors.internal(error);
  }
  if (!data) throw errors.permissionDenied('organizations.organization.publish');
  return { isPublic: data.is_public };
}

/* -------------------------------- الأقسام --------------------------------- */

export async function listDepartments(
  _ctx: AuthContext,
  input: ListQueryInput,
): Promise<Paginated<DepartmentRow>> {
  const supabase = await createClient();
  let query = supabase
    .from('departments')
    .select(DEPARTMENT_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  if (input.status) query = query.eq('status', input.status);
  if (input.search) {
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) query = query.or(`name_ar.ilike.%${term}%,code.ilike.%${term}%`);
  }

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query.order('code').range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const total = count ?? 0;
  return {
    items: (data ?? []).map(toDepartment),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function createDepartment(
  ctx: AuthContext,
  input: DepartmentCreateInput,
): Promise<DepartmentRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('departments')
    .insert({
      organization_id: ctx.organizationId,
      branch_id: input.branchId ?? null,
      parent_id: input.parentId ?? null,
      code: input.code,
      name_ar: input.nameAr,
    })
    .select(DEPARTMENT_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد قسم بنفس الكود', { code: input.code });
    if (error.code === '42501') {
      throw errors.permissionDenied('organizations.departments.manage');
    }
    throw errors.internal(error);
  }
  return toDepartment(data);
}

export async function updateDepartment(
  _ctx: AuthContext,
  input: DepartmentUpdateInput,
): Promise<DepartmentRow> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['departments']['Update'] = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
  if (input.parentId !== undefined) patch.parent_id = input.parentId ?? null;
  if (input.status !== undefined) patch.status = input.status;
  // ⚠️ branch_id غير قابل للتعديل: نقل قسم بين الفروع يحتاج قاعدة عمل معتمدة،
  //    و RLS يرفضه أصلًا عبر WITH CHECK.

  const { data, error } = await supabase
    .from('departments')
    .update(patch)
    .eq('id', input.id)
    .select(DEPARTMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد قسم بنفس الكود');
    throw errors.internal(error);
  }
  if (!data) throw errors.notFound('department');
  return toDepartment(data);
}

/** قائمة مختصرة للفروع — لقوائم الاختيار. محكومة بـ RLS. */
export async function listBranchOptions(): Promise<Array<{ id: UUID; nameAr: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branches')
    .select('id, name_ar')
    .is('deleted_at', null)
    .order('name_ar');
  return (data ?? []).map((r) => ({ id: r.id, nameAr: r.name_ar }));
}

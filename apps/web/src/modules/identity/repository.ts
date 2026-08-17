import 'server-only';

import { randomBytes } from 'node:crypto';
import type { AuthContext, Database, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
/*
  ⚠️ استيراد مقيّد بقاعدة ESLint — والاستثناء هنا واعٍ وموثّق.

  هذا الملف واحد من موضعين فقط في التطبيق يحتاج مفتاح الخدمة، والسبب أن إنشاء
  سجل في `auth.users` وحظره وحذفه لا يمكن عمله بأي مسار آخر. لا يُستخدم المفتاح
  في أي قرار تصريح: كل الفحوص تمر بـ `app.provision_user` بجلسة المدير.
  راجع docs/SECURITY.md §4 والتعليق التفصيلي أسفل هذا الاستيراد.
*/
// eslint-disable-next-line no-restricted-imports
import { createAdminClient, isAdminClientAvailable } from '@/infrastructure/supabase/admin';
import { requireSupabasePublicEnv } from '@/config/env';
import type {
  ProviderAccountInput,
  RoleCreateInput,
  RoleUpdateInput,
  UserAssignmentInput,
  UserCreateInput,
  UserListQueryInput,
  UserStatusInput,
  UserUpdateInput,
} from './schemas';

/**
 * الوصول للبيانات — المستخدمون والأدوار.
 *
 * ⚠️ **حدود مفتاح الخدمة.** المفتاح السري يستخدم هنا لعمل واحد فقط: إنشاء
 *    وحذف وحظر سجل في `auth.users`، وهو ما لا يمكن عمله بأي طريقة أخرى.
 *    كل قرار تصريح — من يُنشئ، بأي دور، في أي فرع — يُتخذ في **قاعدة البيانات
 *    بجلسة المدير** عبر `app.provision_user`. السبب أن مفتاح الخدمة يتجاوز RLS
 *    بالكامل؛ لو بنينا الجانب التنظيمي به لصارت كل حمايات منع التصعيد بلا أثر
 *    في أهم عملية في النظام.
 *
 * ⚠️ لا تُعاد كلمة مرور ولا رابط استعادة إلى واجهة الإدارة في أي مسار.
 */

export interface UserRow {
  id: UUID;
  fullNameAr: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  employeeCode: string | null;
  status: string;
  defaultBranchId: UUID | null;
  roleNames: readonly string[];
  scope: 'organization' | 'branch' | null;
  branchIds: readonly UUID[];
  /** هل هذا الحساب مرتبط بمقدّم خدمة (طبيب)؟ */
  providerId: UUID | null;
}

export interface RoleRow {
  id: UUID;
  key: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  /** null = دور نظامي عام لكل المنشآت ⇒ غير قابل للتعديل من التطبيق. */
  organizationId: UUID | null;
  permissionCount: number;
}

const PROFILE_COLUMNS =
  'id, full_name_ar, phone, job_title, employee_code, status, default_branch_id';

type ProfileRecord = Database['public']['Tables']['profiles']['Row'];

/* ============================== قراءة المستخدمين ============================ */

/**
 * ⚠️ البريد الإلكتروني يسكن `auth.users` لا `profiles`، وقراءته تحتاج مفتاح
 *    الخدمة. لذلك يُقرأ في خطوة منفصلة **مقيّدة بالمعرّفات التي أعادها RLS
 *    أصلًا** — أي أن مفتاح الخدمة لا يوسّع ما يراه المستخدم، بل يكمل حقلًا
 *    للصفوف المسموح بها فقط.
 */
async function attachEmails(ids: readonly string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (ids.length === 0 || !isAdminClientAvailable()) return result;

  const admin = createAdminClient();
  const allowed = new Set(ids);
  // listUsers مُصفّح؛ نمرّ حتى نغطي المطلوب أو تنتهي الصفحات.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const user of data.users) {
      if (allowed.has(user.id)) result.set(user.id, user.email ?? null);
    }
    if (result.size >= ids.length || data.users.length === 0) break;
  }
  return result;
}

export async function listUsers(
  _ctx: AuthContext,
  input: UserListQueryInput,
): Promise<Paginated<UserRow>> {
  const supabase = await createClient();

  let query = supabase
    .from('profiles')
    .select(PROFILE_COLUMNS, { count: 'exact' })
    .is('deleted_at', null);

  if (input.status) query = query.eq('status', input.status);
  if (input.search) {
    const term = input.search.replace(/[(),%*]/g, ' ').trim();
    if (term) {
      query = query.or(
        `full_name_ar.ilike.%${term}%,employee_code.ilike.%${term}%,job_title.ilike.%${term}%`,
      );
    }
  }

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('full_name_ar')
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);

  const [roles, branches, providers, emails] = await Promise.all([
    loadRoleAssignments(ids),
    loadBranchAssignments(ids),
    loadProviderLinks(ids),
    attachEmails(ids),
  ]);

  let items = rows.map((r) => toUserRow(r, roles, branches, providers, emails));

  // فلترة الفرع تُطبَّق بعد التجميع: عضوية الفروع في جدول منفصل، والفلترة
  // عليه في نفس الاستعلام تتطلب علاقة مُعرّفة في الأنواع المُولّدة.
  if (input.branchId) {
    const branchId = input.branchId;
    items = items.filter((u) => u.branchIds.includes(branchId as UUID));
  }

  const total = count ?? 0;
  return {
    items,
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getUser(_ctx: AuthContext, id: string): Promise<UserRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw errors.internal(error);
  if (!data) throw errors.notFound('user');

  const [roles, branches, providers, emails] = await Promise.all([
    loadRoleAssignments([id]),
    loadBranchAssignments([id]),
    loadProviderLinks([id]),
    attachEmails([id]),
  ]);

  return toUserRow(data, roles, branches, providers, emails);
}

/** صلاحيات المستخدم الفعلية — للعرض في صفحة التفاصيل. */
export async function getUserPermissions(id: string): Promise<readonly string[]> {
  const supabase = await createClient();
  const { data: userRoles } = await supabase.from('user_roles').select('role_id').eq('user_id', id);
  const roleIds = (userRoles ?? []).map((r) => r.role_id);
  if (roleIds.length === 0) return [];

  const { data: rolePermissions } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .in('role_id', roleIds);
  const permissionIds = [...new Set((rolePermissions ?? []).map((r) => r.permission_id))];
  if (permissionIds.length === 0) return [];

  const { data: permissions } = await supabase
    .from('permissions')
    .select('key')
    .in('id', permissionIds);
  return [...new Set((permissions ?? []).map((p) => p.key))].sort();
}

type RoleAssignment = { roleName: string; scope: 'organization' | 'branch' };

async function loadRoleAssignments(ids: readonly string[]): Promise<Map<string, RoleAssignment[]>> {
  const map = new Map<string, RoleAssignment[]>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  const { data: assignments } = await supabase
    .from('user_roles')
    .select('user_id, role_id, scope')
    .in('user_id', ids as string[]);

  const roleIds = [...new Set((assignments ?? []).map((a) => a.role_id))];
  if (roleIds.length === 0) return map;

  const { data: roles } = await supabase.from('roles').select('id, name_ar').in('id', roleIds);
  const names = new Map((roles ?? []).map((r) => [r.id, r.name_ar]));

  for (const a of assignments ?? []) {
    const list = map.get(a.user_id) ?? [];
    list.push({
      roleName: names.get(a.role_id) ?? '—',
      scope: a.scope as 'organization' | 'branch',
    });
    map.set(a.user_id, list);
  }
  return map;
}

async function loadBranchAssignments(ids: readonly string[]): Promise<Map<string, UUID[]>> {
  const map = new Map<string, UUID[]>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from('user_branches')
    .select('user_id, branch_id')
    .in('user_id', ids as string[]);

  for (const row of data ?? []) {
    const list = map.get(row.user_id) ?? [];
    list.push(row.branch_id as UUID);
    map.set(row.user_id, list);
  }
  return map;
}

async function loadProviderLinks(ids: readonly string[]): Promise<Map<string, UUID>> {
  const map = new Map<string, UUID>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from('service_providers')
    .select('id, profile_id')
    .in('profile_id', ids as string[]);

  for (const row of data ?? []) {
    if (row.profile_id) map.set(row.profile_id, row.id as UUID);
  }
  return map;
}

function toUserRow(
  r: Pick<
    ProfileRecord,
    'id' | 'full_name_ar' | 'phone' | 'job_title' | 'employee_code' | 'status' | 'default_branch_id'
  >,
  roles: Map<string, RoleAssignment[]>,
  branches: Map<string, UUID[]>,
  providers: Map<string, UUID>,
  emails: Map<string, string | null>,
): UserRow {
  const assignments = roles.get(r.id) ?? [];
  return {
    id: r.id as UUID,
    fullNameAr: r.full_name_ar,
    email: emails.get(r.id) ?? null,
    phone: r.phone,
    jobTitle: r.job_title,
    employeeCode: r.employee_code,
    status: r.status,
    defaultBranchId: r.default_branch_id as UUID | null,
    roleNames: assignments.map((a) => a.roleName),
    scope: assignments.some((a) => a.scope === 'organization')
      ? 'organization'
      : assignments.length > 0
        ? 'branch'
        : null,
    branchIds: branches.get(r.id) ?? [],
    providerId: providers.get(r.id) ?? null,
  };
}

/* ============================== إنشاء المستخدم ============================== */

export interface CreatedUser {
  id: UUID;
  fullNameAr: string;
  email: string;
  /**
   * هل أُرسلت رسالة تعيين كلمة المرور؟
   * false = خادم البريد غير مهيّأ في هذه البيئة ⇒ على المستخدم استخدام
   * «نسيت كلمة المرور». **لا نعرض كلمة مرور ولا رابطًا كبديل.**
   */
  invitationSent: boolean;
  /** true = المدير ضبط كلمة المرور بنفسه ⇒ لا رسالة تعيين. */
  passwordSetByAdmin: boolean;
}

/**
 * إنشاء مستخدم كامل.
 *
 * التسلسل مقصود بهذا الترتيب:
 *   1) فحص مسبق في التطبيق  ⇒ يقلّل نافذة إنشاء حساب مصادقة بلا مقابل تنظيمي.
 *   2) إنشاء `auth.users`     ⇒ بمفتاح الخدمة، لأنه المسار الوحيد الممكن.
 *   3) `app.provision_user`   ⇒ **بجلسة المدير**، فيُعيد المحرّك فحص كل شيء
 *                               ويُدرج profile + user_roles + user_branches ذريًا.
 *   4) عند فشل (3) نحذف حساب المصادقة ⇒ لا يبقى حساب قابل للدخول بلا ملف.
 *
 * ⚠️ الخطوتان 2 و 3 لا تشتركان في معاملة واحدة — لا يمكن ذلك، فهما نظامان
 *    مختلفان. لذلك خطوة التعويض في (4) ليست تحسينًا بل شرط سلامة.
 */
export async function createUser(ctx: AuthContext, input: UserCreateInput): Promise<CreatedUser> {
  if (!isAdminClientAvailable()) {
    throw errors.internal(
      new Error('إنشاء المستخدمين يتطلب ضبط SUPABASE_SECRET_KEY في الخادم (server-side فقط).'),
    );
  }

  // (1) فحص مسبق: النطاق والفروع. القرار النهائي في المحرّك، وهذا لتحسين الرسالة.
  if (input.scope === 'organization' && !ctx.hasOrganizationScope) {
    throw errors.permissionDenied('identity.roles.manage');
  }
  for (const branchId of input.branchIds) {
    if (!ctx.hasOrganizationScope && !ctx.branchIds.includes(branchId as UUID)) {
      throw errors.branchAccessDenied(branchId);
    }
  }

  const admin = createAdminClient();

  /*
    (2) حساب المصادقة.

    ⚠️ كلمة المرور: إن ضبطها المدير تُستخدم كما هي، وإلا عشوائية 32 بايت لا
       يعرفها أحد. في الحالتين **لا تُعاد ولا تُسجَّل ولا تُخزَّن** خارج Auth.
    ⚠️ `mustChangePassword` في البيانات الوصفية علامة للمراجعة الإدارية:
       كلمة يضعها طرف ثالث يجب أن يغيّرها صاحبها. **فرض التغيير عند أول دخول
       غير منفّذ** — يحتاج قرارك (هل يُمنع الدخول حتى التغيير؟).
  */
  const adminSetPassword = Boolean(input.initialPassword);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    ...(input.phone ? { phone: input.phone } : {}),
    password: adminSetPassword ? input.initialPassword : randomBytes(32).toString('base64url'),
    email_confirm: true,
    user_metadata: {
      full_name_ar: input.fullNameAr,
      ...(adminSetPassword ? { mustChangePassword: true } : {}),
    },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? '';
    if (/already/i.test(message)) {
      throw errors.conflict('يوجد مستخدم بهذا البريد الإلكتروني', { email: input.email });
    }
    throw errors.internal(createError ?? new Error('فشل إنشاء حساب المصادقة'));
  }

  const userId = created.user.id;

  // (3) الجانب التنظيمي بجلسة المدير — هنا تُفرض كل قواعد النطاق والتصعيد.
  const supabase = await createClient();
  const { error: rpcError } = await supabase.rpc('provision_user', {
    p_user_id: userId,
    p_full_name_ar: input.fullNameAr,
    p_role_id: input.roleId,
    p_scope: input.scope,
    p_branch_ids: input.branchIds as string[],
    p_phone: input.phone || null,
    p_job_title: input.jobTitle || null,
    p_employee_code: input.employeeCode || null,
    p_default_branch_id: input.defaultBranchId ?? null,
    p_provider_id: input.providerId ?? null,
  });

  if (rpcError) {
    // (4) تعويض: لا نترك حسابًا قابلًا للدخول بلا ملف ولا دور
    await admin.auth.admin.deleteUser(userId).catch(() => {
      console.error('[identity] تعذّر حذف حساب المصادقة بعد فشل التجهيز', userId);
    });
    throw translateRpcError(rpcError);
  }

  /*
    ⚠️ لا تُرسَل رسالة تعيين حين يضبط المدير كلمة المرور: إرسالها يُبطل ما
       ضبطه ويُربك الموظف الذي أُعطي كلمة مرور تعمل بالفعل.
  */
  return {
    id: userId as UUID,
    fullNameAr: input.fullNameAr,
    email: input.email,
    invitationSent: adminSetPassword ? false : await sendPasswordSetupEmail(input.email),
    passwordSetByAdmin: adminSetPassword,
  };
}

/**
 * رسالة تعيين كلمة المرور.
 *
 * تعيد استخدام مسار «نسيت كلمة المرور» نفسه (المرحلة 0) بدل مسار ثانٍ:
 * المستخدم يضبط كلمة مروره بنفسه ولا تمر بأي واجهة إدارة.
 *
 * ⚠️ الفشل هنا **لا يُفشل** إنشاء المستخدم: الحساب صحيح ويمكن للمستخدم استخدام
 *    «نسيت كلمة المرور» متى شاء. نُبلّغ المدير بالحالة ولا نبتكر بديلًا يكشف سرًا.
 */
async function sendPasswordSetupEmail(email: string): Promise<boolean> {
  try {
    const { url } = requireSupabasePublicEnv();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? url}/auth/callback?next=/reset-password`,
    });
    return !error;
  } catch {
    return false;
  }
}

/* ============================== تعديل المستخدم ============================== */

export async function updateUser(_ctx: AuthContext, input: UserUpdateInput): Promise<UserRow> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['profiles']['Update'] = {};
  if (input.fullNameAr !== undefined) patch.full_name_ar = input.fullNameAr;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.jobTitle !== undefined) patch.job_title = input.jobTitle || null;
  if (input.employeeCode !== undefined) patch.employee_code = input.employeeCode || null;
  // ⚠️ status و organization_id و الدور والفروع غير مذكورة عمدًا — لكل منها
  //    فعل منفصل بصلاحية منفصلة، ومحفّز في قاعدة البيانات يفرض ذلك.

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', input.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) throw translateRpcError(error);
  // RLS تُطابق صفر صفوف بصمت عند رفض النطاق — نحوّله إلى خطأ صريح
  if (!data) throw errors.permissionDenied('identity.users.update');

  return toUserRow(data, new Map(), new Map(), new Map(), new Map());
}

/**
 * إيقاف/إعادة تفعيل.
 *
 * طبقتان مقصودتان:
 *   • `profiles.status` ⇒ يُلغي كل الصلاحيات في المحرّك فورًا (RLS).
 *   • حظر GoTrue        ⇒ يمنع تجديد الرمز وتسجيل الدخول من الأساس.
 * الأولى وحدها تترك للمستخدم جلسة صالحة برمز حيّ لكن بلا أي بيانات؛
 * الثانية وحدها لا تُلغي جلسة قائمة. الاثنتان معًا هي المنع الفعلي.
 */
export async function setUserStatus(_ctx: AuthContext, input: UserStatusInput): Promise<UserRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ status: input.status })
    .eq('id', input.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) throw translateRpcError(error);
  if (!data) throw errors.permissionDenied('identity.users.update');

  if (isAdminClientAvailable()) {
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(input.id, {
      // 100 عام ≈ حظر دائم. 'none' يرفعه.
      ban_duration: input.status === 'suspended' ? '876000h' : 'none',
    });
    if (banError) {
      // الطبقة الأولى نجحت ⇒ المستخدم بلا صلاحيات فعليًا. نُسجّل ولا نتراجع.
      console.error('[identity] تعذّر تطبيق حظر GoTrue', banError.message);
    }
  }

  return toUserRow(data, new Map(), new Map(), new Map(), new Map());
}

/** تغيير الدور والفروع — استبدال ذري داخل المحرّك بنفس فحوص التصعيد. */
export async function setUserAssignment(
  _ctx: AuthContext,
  input: UserAssignmentInput,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_assignment', {
    p_user_id: input.id,
    p_role_id: input.roleId,
    p_scope: input.scope,
    p_branch_ids: input.branchIds as string[],
  });
  if (error) throw translateRpcError(error);
}

/* ============================ حساب لمقدّم خدمة ============================= */

/**
 * إنشاء حساب دخول لطبيب/مقدّم خدمة قائم — **باختيار المدير فقط** (RQ-02).
 * يمر بنفس مسار `createUser` فيخضع لنفس الفحوص، ويربط `service_providers.profile_id`
 * داخل نفس معاملة التجهيز.
 */
export async function createProviderAccount(
  ctx: AuthContext,
  input: ProviderAccountInput,
): Promise<CreatedUser> {
  const supabase = await createClient();
  const { data: provider, error } = await supabase
    .from('service_providers')
    .select('id, full_name_ar, profile_id, phone')
    .eq('id', input.providerId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw errors.internal(error);
  if (!provider) throw errors.notFound('service_provider');
  if (provider.profile_id) {
    throw errors.conflict('هذا المقدّم مرتبط بحساب دخول بالفعل', { providerId: input.providerId });
  }

  return createUser(ctx, {
    fullNameAr: provider.full_name_ar,
    email: input.email,
    phone: provider.phone ?? '',
    jobTitle: '',
    employeeCode: '',
    roleId: input.roleId,
    scope: 'branch',
    branchIds: input.branchIds,
    defaultBranchId: input.branchIds[0] ?? null,
    providerId: input.providerId,
  });
}

/* ================================= الأدوار ================================= */

/** النطاق يأتي من RLS: الأدوار النظامية + أدوار منشأة المستخدم فقط. */
export async function listRoles(): Promise<readonly RoleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('roles')
    .select('id, key, name_ar, description, is_system, organization_id')
    .order('is_system', { ascending: false })
    .order('name_ar');
  if (error) throw errors.internal(error);

  const roles = data ?? [];
  const counts = new Map<string, number>();
  if (roles.length > 0) {
    const { data: rolePermissions } = await supabase
      .from('role_permissions')
      .select('role_id')
      .in(
        'role_id',
        roles.map((r) => r.id),
      );
    for (const row of rolePermissions ?? []) {
      counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
    }
  }

  return roles.map((r) => ({
    id: r.id as UUID,
    key: r.key,
    nameAr: r.name_ar,
    description: r.description,
    isSystem: r.is_system,
    organizationId: r.organization_id as UUID | null,
    permissionCount: counts.get(r.id) ?? 0,
  }));
}

/** مفاتيح صلاحيات دور محدد — لعرض/تعديل الدور. */
export async function getRolePermissionKeys(roleId: string): Promise<readonly string[]> {
  const supabase = await createClient();
  const { data: links } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .eq('role_id', roleId);
  const ids = (links ?? []).map((l) => l.permission_id);
  if (ids.length === 0) return [];
  const { data } = await supabase.from('permissions').select('key').in('id', ids);
  return (data ?? []).map((p) => p.key);
}

/**
 * إنشاء دور خاص بالمنشأة.
 *
 * ⚠️ لا يُعاد تصميم نظام الصلاحيات: الأدوار النظامية (organization_id = null)
 *    تبقى كما هي وغير قابلة للتعديل — سياسات RLS تفرض ذلك. ما يُضاف هنا هو
 *    أدوار مخصّصة للمنشأة فقط.
 * ⚠️ محفّز `guard_permission_escalation` يرفض أي صلاحية لا يملكها المُنشئ.
 */
export async function createRole(ctx: AuthContext, input: RoleCreateInput): Promise<RoleRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('roles')
    .insert({
      organization_id: ctx.organizationId,
      key: input.key,
      name_ar: input.nameAr,
      description: input.description || null,
      is_system: false,
    })
    .select('id, key, name_ar, description, is_system, organization_id')
    .single();

  if (error) {
    if (error.code === '23505') throw errors.conflict('يوجد دور بنفس المعرّف', { key: input.key });
    throw translateRpcError(error);
  }

  await replaceRolePermissions(data.id, input.permissionKeys);

  return {
    id: data.id as UUID,
    key: data.key,
    nameAr: data.name_ar,
    description: data.description,
    isSystem: data.is_system,
    organizationId: data.organization_id as UUID | null,
    permissionCount: input.permissionKeys.length,
  };
}

export async function updateRole(_ctx: AuthContext, input: RoleUpdateInput): Promise<void> {
  const supabase = await createClient();
  const patch: Database['public']['Tables']['roles']['Update'] = {};
  if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
  if (input.description !== undefined) patch.description = input.description || null;

  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase
      .from('roles')
      .update(patch)
      .eq('id', input.id)
      .select('id')
      .maybeSingle();
    if (error) throw translateRpcError(error);
    if (!data) throw errors.permissionDenied('identity.roles.manage');
  }

  if (input.permissionKeys !== undefined) {
    await replaceRolePermissions(input.id, input.permissionKeys);
  }
}

/**
 * استبدال صلاحيات الدور.
 *
 * ⚠️ ليست عملية ذرية: الحذف والإضافة نداءان على PostgREST. مقبول هنا لأن
 *    النتيجة الوسطى هي «صلاحيات أقل» لا أكثر — أي أن الفشل في المنتصف يتجه
 *    نحو الأمان لا نحو التصعيد. أي صلاحية لا يملكها المُدير يرفضها المحفّز.
 */
async function replaceRolePermissions(roleId: string, keys: readonly string[]): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId);
  if (deleteError) throw translateRpcError(deleteError);

  if (keys.length === 0) return;

  const { data: permissions, error: permError } = await supabase
    .from('permissions')
    .select('id, key')
    .in('key', keys as string[]);
  if (permError) throw errors.internal(permError);

  const rows = (permissions ?? []).map((p) => ({ role_id: roleId, permission_id: p.id }));
  if (rows.length === 0) return;

  const { error } = await supabase.from('role_permissions').insert(rows);
  if (error) throw translateRpcError(error);
}

/* ================================= مساعدات ================================= */

/** خيارات الفروع للنماذج — محدودة بنطاق المستخدم عبر RLS. */
export async function listBranchOptions(): Promise<ReadonlyArray<{ id: UUID; nameAr: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branches')
    .select('id, name_ar')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name_ar');
  return (data ?? []).map((b) => ({ id: b.id as UUID, nameAr: b.name_ar }));
}

/** مقدّمو الخدمة بلا حساب دخول — مرشّحو إنشاء الحسابات. */
export async function listProvidersWithoutAccount(): Promise<
  ReadonlyArray<{ id: UUID; nameAr: string; specialty: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('service_providers')
    .select('id, full_name_ar, specialty')
    .is('profile_id', null)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('full_name_ar');
  return (data ?? []).map((p) => ({
    id: p.id as UUID,
    nameAr: p.full_name_ar,
    specialty: p.specialty,
  }));
}

/**
 * يحوّل أخطاء المحرّك إلى أخطاء تطبيق مفهومة.
 *
 * ⚠️ رسائل الحُرّاس مكتوبة بالعربية للمستخدم النهائي ولا تكشف بنية جداول،
 *    لذلك تُمرَّر كما هي. أي خطأ آخر يُعمَّم.
 */
function translateRpcError(error: { code?: string; message?: string }): Error {
  if (error.code === '42501') {
    return errors.operationDenied(error.message ?? 'العملية مرفوضة');
  }
  if (error.code === '22023' || error.code === '22P02') {
    return errors.validation({ _: [error.message ?? 'مدخل غير صالح'] });
  }
  if (error.code === '23505') {
    return errors.conflict(error.message ?? 'تعارض في البيانات');
  }
  return errors.internal(error);
}

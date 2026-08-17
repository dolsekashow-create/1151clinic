import 'server-only';

import { cache } from 'react';
import type { AuthContext, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';

/**
 * بناء سياق الطلب الموثوق.
 *
 * ⚠️ كل بيانات السياق تُقرأ من قاعدة البيانات بجلسة المستخدم نفسها — لا من
 *    مدخلات العميل ولا من مطالبات JWT قابلة للتزوير. هذا يعني أن سياسات RLS
 *    تُطبَّق حتى أثناء بناء السياق: مستخدم معطّل لا يستطيع بناء سياق أصلًا.
 *
 * `cache()` من React تجعل الاستدعاء يحدث مرة واحدة لكل طلب مهما تكرر
 * في المكوّنات — لا يُخزَّن بين الطلبات ولا بين المستخدمين.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();

  // getUser() يتحقق من التوقيع مع خادم المصادقة — getSession() لا يفعل.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const [profileResult, branchesResult, rolesResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, organization_id, status')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('user_branches').select('branch_id').eq('user_id', user.id),
    supabase.from('user_roles').select('scope, role_id').eq('user_id', user.id),
  ]);

  const profile = profileResult.data;
  if (!profile) return null;

  const roles = rolesResult.data ?? [];
  const hasOrganizationScope = roles.some((role) => role.scope === 'organization');

  const permissions = await loadPermissions(
    supabase,
    roles.map((role) => role.role_id),
  );

  return {
    userId: profile.id as UUID,
    organizationId: profile.organization_id as UUID,
    email: user.email ?? null,
    status: profile.status as AuthContext['status'],
    branchIds: (branchesResult.data ?? []).map((row) => row.branch_id as UUID),
    hasOrganizationScope,
    permissions,
  };
});

/**
 * يُحمّل مفاتيح الصلاحيات على خطوتين بدل استعلام متداخل (embedded resource).
 * السبب: الاستعلام المتداخل يتطلب بيانات علاقات في الأنواع المُولّدة، والفصل
 * هنا أوضح ولا يفقد شيئًا — القائمتان صغيرتان ومفهرستان.
 */
async function loadPermissions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleIds: readonly string[],
): Promise<readonly string[]> {
  if (roleIds.length === 0) return [];

  const { data: rolePermissions } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .in('role_id', roleIds as string[]);

  const permissionIds = [...new Set((rolePermissions ?? []).map((row) => row.permission_id))];
  if (permissionIds.length === 0) return [];

  const { data: permissions } = await supabase
    .from('permissions')
    .select('key')
    .in('id', permissionIds);

  return [...new Set((permissions ?? []).map((row) => row.key))];
}

/**
 * يرمي UNAUTHENTICATED إذا لم توجد جلسة صالحة أو كان الحساب موقوفًا.
 *
 * ⚠️ رفض الموقوف هنا ضروري ولا يكفي عنه RLS: قاعدة البيانات تُلغي كل صلاحياته
 *    فعلًا، لكن الجلسة تبقى صالحة فيدخل الموقوف إلى `/app` ويرى واجهة فارغة
 *    بلا تفسير. الرفض المبكر يُخرجه إلى صفحة الدخول برسالة مفهومة.
 *
 * الطبقة الثالثة هي حظر GoTrue عند الإيقاف (setUserStatus) الذي يمنع تجديد
 * الرمز من الأساس. الثلاث معًا هي «منع الدخول» الفعلي.
 */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw errors.unauthenticated();
  if (context.status !== 'active') throw errors.accountSuspended();
  return context;
}

/** هل الحساب موقوف؟ للاستخدام في الطبقات التي تحتاج تمييز السبب. */
export async function getSuspendedContext(): Promise<AuthContext | null> {
  const context = await getAuthContext();
  return context && context.status !== 'active' ? context : null;
}

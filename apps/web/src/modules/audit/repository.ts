import 'server-only';

import type { AuthContext, Paginated, UUID } from '@erp/types';
import { errors } from '@erp/core';
import { createClient } from '@/infrastructure/supabase/server';
import type { AuditListQueryInput } from './schemas';

/**
 * قراءة سجل التدقيق.
 *
 * ⚠️ قراءة فقط — لا تعديل ولا حذف. الجدول append-only يفرضه محفّز
 *    `audit_logs_immutable` في قاعدة البيانات، لا اتفاق في الكود.
 * ⚠️ RLS تقصر الرؤية على المنشأة + الفروع التي يصلها المستخدم + صلاحية
 *    `audit.view`. لا فلترة أمنية هنا.
 */

export interface AuditRow {
  id: number;
  action: string;
  module: string;
  entityType: string;
  entityId: UUID | null;
  branchId: UUID | null;
  branchName: string | null;
  userId: UUID | null;
  userName: string | null;
  newValues: unknown;
  createdAt: string;
}

const AUDIT_COLUMNS =
  'id, action, module, entity_type, entity_id, branch_id, user_id, new_values, created_at';

export async function listAuditLogs(
  _ctx: AuthContext,
  input: AuditListQueryInput,
): Promise<Paginated<AuditRow>> {
  const supabase = await createClient();

  let query = supabase.from('audit_logs').select(AUDIT_COLUMNS, { count: 'exact' });

  if (input.module) query = query.eq('module', input.module);
  if (input.branchId) query = query.eq('branch_id', input.branchId);
  if (input.userId) query = query.eq('user_id', input.userId);
  if (input.entityType) query = query.eq('entity_type', input.entityType);
  if (input.action) query = query.ilike('action', `%${input.action.replace(/[%*]/g, '')}%`);
  if (input.from) query = query.gte('created_at', `${input.from}T00:00:00Z`);
  if (input.to) query = query.lte('created_at', `${input.to}T23:59:59Z`);

  const from = (input.page - 1) * input.pageSize;
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + input.pageSize - 1);
  if (error) throw errors.internal(error);

  const rows = data ?? [];

  // الأسماء في جداول أخرى؛ نجلبها مُجمَّعة وبجلسة المستخدم نفسها
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => v !== null))];
  const branchIds = [...new Set(rows.map((r) => r.branch_id).filter((v): v is string => v !== null))];

  const [profiles, branches] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, full_name_ar').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; full_name_ar: string }[] }),
    branchIds.length > 0
      ? supabase.from('branches').select('id, name_ar').in('id', branchIds)
      : Promise.resolve({ data: [] as { id: string; name_ar: string }[] }),
  ]);

  const userMap = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name_ar]));
  const branchMap = new Map((branches.data ?? []).map((b) => [b.id, b.name_ar]));

  const total = count ?? 0;
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      module: r.module,
      entityType: r.entity_type,
      entityId: r.entity_id as UUID | null,
      branchId: r.branch_id as UUID | null,
      branchName: r.branch_id ? (branchMap.get(r.branch_id) ?? null) : null,
      userId: r.user_id as UUID | null,
      // مستخدم محذوف أو خارج نطاق القارئ ⇒ لا اسم، ولا تسريب
      userName: r.user_id ? (userMap.get(r.user_id) ?? null) : null,
      newValues: r.new_values,
      createdAt: r.created_at,
    })),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

/** الوحدات الموجودة فعلًا في السجل — لبناء المرشِّح بلا قائمة ثابتة. */
export async function listAuditModules(): Promise<readonly string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('audit_logs').select('module').limit(1000);
  return [...new Set((data ?? []).map((r) => r.module))].sort();
}

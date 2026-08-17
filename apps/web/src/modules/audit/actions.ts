'use server';

import type { Paginated } from '@erp/types';
import { defineQuery } from '@/shared/lib/action';
import { listAuditLogs, type AuditRow } from './repository';
import { auditListQuerySchema } from './schemas';

/**
 * أفعال سجل التدقيق — قراءة فقط.
 *
 * ⚠️ لا فعل كتابة هنا عمدًا: السجل يُكتب من `defineAction` مع كل عملية مؤثرة،
 *    وإتاحة كتابة مباشرة تجعل تزوير السجل ممكنًا من الواجهة.
 * ⚠️ قراءة السجل نفسها لا تُسجَّل — وإلا نما السجل بلا حد من مجرد تصفّحه.
 */
export const listAuditLogsAction = defineQuery<
  ReturnType<typeof auditListQuerySchema.parse>,
  Paginated<AuditRow>
>({
  permission: 'audit.view',
  schema: auditListQuerySchema,
  handler: async (ctx, input) => {
    const result = await listAuditLogs(ctx, input);
    return { data: result, meta: result.meta };
  },
});

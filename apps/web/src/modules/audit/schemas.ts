import { z } from 'zod';

/**
 * مخططات سجل التدقيق — قراءة فقط.
 * ⚠️ لا مخطط كتابة: السجل append-only ويُكتب حصرًا من `defineAction`.
 */
export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  module: z.string().trim().max(50).optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(50).optional(),
  branchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD')
    .optional(),
});
export type AuditListQueryInput = z.infer<typeof auditListQuerySchema>;
